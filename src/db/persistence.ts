import type { AppData } from '@/types';
import { useStore, selectData, migrateData, mergeSettings } from '@/store/useStore';
import { fromRecords, recordOrders, splitKey, toRecords } from './records';
import { metaGet, metaSet, type LocalRecord, type UserDb } from './localDb';

/**
 * PERSISTENCIA DEL STORE EN INDEXEDDB
 * Sustituye al middleware `persist` (que guardaba todo el estado como un único JSON en localStorage).
 * Tras cada cambio (con un pequeño retraso) compara el estado con lo último guardado y escribe solo
 * los registros que cambiaron, marcados como pendientes de sincronizar. Las acciones del store no
 * necesitan saber nada de esto.
 */

const FLUSH_DELAY_MS = 400;
const DEVICE_TIMER_KEY = 'device:activeTimer';

/** Colecciones cuyo orden importa entre dispositivos (se insertan al principio) */
const ORDER_SYNCED = new Set(['conversations']);

type Listener = () => void;

let db: UserDb | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> = Promise.resolve();
/** Último valor guardado por registro: referencia (comparación rápida) y JSON (comparación real) */
let savedRef = new Map<string, unknown>();
let savedJson = new Map<string, string>();
let savedOrder = new Map<string, number | undefined>();
/** Marca de tiempo guardada por registro: un cambio nuevo siempre la supera (aunque el reloj vaya atrasado) */
let savedTs = new Map<string, number>();
let savedTimerJson = 'null';
const changeListeners = new Set<Listener>();

/** Avisa cuando hay cambios locales guardados (el motor de sincronización programa una subida) */
export function onLocalChange(fn: Listener): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function remember(records: LocalRecord[]) {
  savedRef = new Map();
  savedJson = new Map();
  savedOrder = new Map();
  savedTs = new Map();
  for (const r of records) {
    savedTs.set(r.key, r.updatedAt);
    if (r.deleted) continue;
    savedRef.set(r.key, r.value);
    savedJson.set(r.key, JSON.stringify(r.value));
    savedOrder.set(r.key, r.order);
  }
}

/** Registros guardados → datos listos para el store (migraciones + ajustes completos) */
function loadData(live: LocalRecord[]): AppData {
  const data = migrateData(fromRecords(live), 0, false) as AppData;
  data.settings = mergeSettings(data.settings);
  return data;
}

/** Lee la base de la cuenta y la vuelca al store. Devuelve true si la cuenta no tenía ningún dato. */
export async function hydrateFromDb(target: UserDb): Promise<{ empty: boolean }> {
  const all = await target.records.toArray();
  const live = all.filter((r) => !r.deleted);
  const data = loadData(live);
  data.activeTimer = (await metaGet<AppData['activeTimer']>(target, DEVICE_TIMER_KEY)) ?? null;
  remember(all);
  savedTimerJson = JSON.stringify(data.activeTimer);
  useStore.setState(data);
  return { empty: live.length === 0 };
}

/** Empieza a guardar los cambios del store en `target` */
export function attachPersistence(target: UserDb) {
  detachPersistence();
  db = target;
  unsubscribe = useStore.subscribe((s, prev) => {
    if (s === prev) return;
    schedule();
  });
  // Las migraciones de `hydrateFromDb` pueden haber cambiado algo: se guarda en la primera pasada
  schedule();
}

export function detachPersistence() {
  unsubscribe?.();
  unsubscribe = null;
  if (timer) clearTimeout(timer);
  timer = null;
  db = null;
  savedRef = new Map();
  savedJson = new Map();
  savedOrder = new Map();
  savedTs = new Map();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushNow(), FLUSH_DELAY_MS);
}

/** Guarda ya los cambios pendientes (antes de sincronizar o de cerrar sesión) */
export function flushNow(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  flushing = flushing.then(writeChanges).catch((err) => {
    console.error('[DB] No se pudieron guardar los cambios:', err);
    window.dispatchEvent(new CustomEvent('constancia:storage-error'));
  });
  return flushing;
}

async function writeChanges() {
  const target = db;
  if (!target) return;
  const data = selectData(useStore.getState());
  const records = toRecords(data);
  const orders = recordOrders(data);
  const now = Date.now();
  const stamp = (key: string) => {
    const ts = Math.max(now, (savedTs.get(key) ?? 0) + 1);
    savedTs.set(key, ts);
    return ts;
  };
  const puts: LocalRecord[] = [];
  let synced = false;

  for (const [key, value] of records) {
    const order = orders.get(key);
    const orderChanged = savedOrder.get(key) !== order;
    if (savedRef.get(key) === value && !orderChanged) continue;
    const json = JSON.stringify(value);
    const valueChanged = savedJson.get(key) !== json;
    savedRef.set(key, value);
    if (!valueChanged && !orderChanged) continue;
    const syncOrder = orderChanged && ORDER_SYNCED.has(splitKey(key).collection);
    const dirty = valueChanged || syncOrder;
    savedJson.set(key, json);
    savedOrder.set(key, order);
    if (dirty) {
      synced = true;
      puts.push({ key, value: JSON.parse(json), order, updatedAt: stamp(key), deleted: 0, dirty: 1 });
    } else {
      // Solo cambió la posición tras borrar otro elemento: se guarda en local sin volver a subirlo
      const existing = await target.records.get(key);
      if (existing) puts.push({ ...existing, order });
    }
  }

  for (const key of [...savedJson.keys()]) {
    if (records.has(key)) continue;
    savedJson.delete(key);
    savedRef.delete(key);
    savedOrder.delete(key);
    synced = true;
    puts.push({ key, value: null, updatedAt: stamp(key), deleted: 1, dirty: 1 });
  }

  if (puts.length) await target.records.bulkPut(puts);

  const timerJson = JSON.stringify(data.activeTimer ?? null);
  if (timerJson !== savedTimerJson) {
    savedTimerJson = timerJson;
    await metaSet(target, DEVICE_TIMER_KEY, data.activeTimer ?? null);
  }

  if (synced) changeListeners.forEach((fn) => fn());
}

/**
 * Tras aplicar cambios llegados de otro dispositivo a la base: recarga el store sin marcar nada
 * como pendiente (lo recargado ya coincide con lo guardado).
 */
export async function reloadFromDb(): Promise<void> {
  const target = db;
  if (!target) return;
  const all = await target.records.toArray();
  const live = all.filter((r) => !r.deleted);
  const data = loadData(live);
  remember(all);
  const { activeTimer } = useStore.getState();
  useStore.setState({ ...data, activeTimer });
  // migrateData puede completar campos (p. ej. la conversación principal): se guardan si cambió algo
  schedule();
}
