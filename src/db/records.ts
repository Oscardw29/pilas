import type { AppData } from '@/types';
import { createEmptyData } from '@/data/seed';

/**
 * REGISTROS SINCRONIZABLES
 * El estado de la app (AppData) se descompone en registros pequeños e independientes
 * (`colección:id` → valor). Es la unidad que se guarda en IndexedDB, se cifra y se sincroniza:
 * dos dispositivos que editan cosas distintas no se pisan.
 */

/** Colecciones guardadas como lista de objetos con `id` */
export const ID_COLLECTIONS = [
  'goals', 'habits', 'sessions', 'energy', 'challenges', 'experiments', 'relations', 'weeklyReviews',
  'checkins', 'habitReviews', 'rewards', 'redemptions', 'pointEvents', 'conversations',
] as const satisfies readonly (keyof AppData)[];

/** Colecciones guardadas como mapa `clave → valor` (cada entrada es un registro) */
export const MAP_COLLECTIONS = ['logs', 'achievements', 'recommendationFeedback', 'dismissedInsights'] as const satisfies readonly (keyof AppData)[];

/** Valores sueltos: un registro cada uno en la colección `single` */
export const SINGLE_FIELDS = ['settings', 'hasStreakFreeze', 'streakFreezes', 'activeConversationId'] as const satisfies readonly (keyof AppData)[];

/**
 * Solo de este dispositivo: no se sincronizan.
 * - `activeTimer`: un temporizador en marcha pertenece al equipo donde se inició.
 * - `version`: la versión del esquema se recalcula al cargar.
 */
export const DEVICE_FIELDS = ['activeTimer'] as const satisfies readonly (keyof AppData)[];

export type IdCollection = (typeof ID_COLLECTIONS)[number];
export type MapCollection = (typeof MAP_COLLECTIONS)[number];
export type Collection = IdCollection | MapCollection | 'single';

export const recordKey = (collection: Collection, id: string) => `${collection}:${id}`;

export function splitKey(key: string): { collection: Collection; id: string } {
  const i = key.indexOf(':');
  return { collection: key.slice(0, i) as Collection, id: key.slice(i + 1) };
}

/** AppData → mapa de registros (sin los campos del dispositivo) */
export function toRecords(data: AppData): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const c of ID_COLLECTIONS) {
    const list = data[c] as { id: string }[] | undefined;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && typeof item.id === 'string') out.set(recordKey(c, item.id), item);
    }
  }
  for (const c of MAP_COLLECTIONS) {
    const map = data[c] as Record<string, unknown> | undefined;
    if (!map || typeof map !== 'object') continue;
    for (const [k, v] of Object.entries(map)) out.set(recordKey(c, k), v);
  }
  for (const f of SINGLE_FIELDS) {
    if (data[f] !== undefined) out.set(recordKey('single', f), data[f]);
  }
  return out;
}

/**
 * Registros → AppData. Las listas se ordenan por la posición que tenían al guardarse (`order`),
 * así el orden visible se conserva entre dispositivos aunque los registros lleguen desordenados.
 */
export function fromRecords(records: Iterable<{ key: string; value: unknown; order?: number }>): AppData {
  const data = createEmptyData() as unknown as Record<string, unknown>;
  const lists: Record<string, { order: number; value: unknown }[]> = {};

  for (const r of records) {
    const { collection, id } = splitKey(r.key);
    if ((ID_COLLECTIONS as readonly string[]).includes(collection)) {
      (lists[collection] ??= []).push({ order: r.order ?? 0, value: r.value });
    } else if ((MAP_COLLECTIONS as readonly string[]).includes(collection)) {
      (data[collection] as Record<string, unknown>)[id] = r.value;
    } else if (collection === 'single' && (SINGLE_FIELDS as readonly string[]).includes(id)) {
      data[id] = r.value;
    }
  }
  for (const [c, items] of Object.entries(lists)) {
    data[c] = items.sort((a, b) => a.order - b.order).map((i) => i.value);
  }
  return data as unknown as AppData;
}

/** Posición de cada elemento de lista dentro de su colección (para conservar el orden) */
export function recordOrders(data: AppData): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of ID_COLLECTIONS) {
    const list = data[c] as { id: string }[] | undefined;
    list?.forEach((item, i) => item && out.set(recordKey(c, item.id), i));
  }
  return out;
}
