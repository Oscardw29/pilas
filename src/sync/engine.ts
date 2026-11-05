import type { AccountKeys } from '@/crypto/keys';
import { openJson } from '@/crypto/keys';
import { metaGet, metaSet, type LocalRecord, type UserDb } from '@/db/localDb';
import type { PullCursor, RecordBody, Remote, RemoteRow } from './remote';

/**
 * MOTOR DE SINCRONIZACIÓN
 * - Subida: los registros locales marcados `dirty` se envían en lotes.
 * - Bajada: se piden los registros que el servidor recibió después del último cursor y se aplican.
 *   Si el mismo registro cambió en dos sitios gana el cambio más reciente (last-write-wins por registro).
 * - Cuentas de antes: sus filas llegaron cifradas de extremo a extremo; con las claves antiguas (`legacy`)
 *   se descifran al bajarlas y `migrateLegacy` las vuelve a subir legibles.
 * Es independiente de Supabase y de React: recibe la base local y el transporte.
 */

const PUSH_BATCH = 200;
const PULL_PAGE = 500;
/**
 * El cursor se retrasa un poco: una escritura que empezó antes en el servidor pero terminó después
 * de una descarga podría tener una marca anterior al cursor. Reaplicar registros no hace daño.
 * Ese repaso se hace UNA sola vez: si la descarga siguiente no trae nada más nuevo que lo ya visto,
 * el cursor salta a lo último visto. Si no, cada sincronización (cada 2 min con la app abierta)
 * volvería a bajar todo lo del último minuto para siempre (tráfico de salida de Supabase).
 */
const CURSOR_OVERLAP_MS = 60_000;
const CURSOR_KEY = 'sync:cursor';
/** Última fila descargada (la más nueva): marca exacta, sin el margen */
const SEEN_KEY = 'sync:seen';
/** Lápidas ya subidas que se pueden olvidar en local */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface SyncResult {
  pushed: number;
  /** Registros de otros dispositivos aplicados en local */
  applied: number;
  /** Claves (`colección:id`) de esos registros */
  appliedKeys: string[];
  /** Filas cifradas de antes que no se pudieron leer (sin las claves antiguas de la cuenta) */
  unreadable: number;
}

export async function pushDirty(db: UserDb, remote: Remote): Promise<number> {
  const dirty = await db.records.where('dirty').equals(1).toArray();
  let pushed = 0;
  for (let i = 0; i < dirty.length; i += PUSH_BATCH) {
    const batch = dirty.slice(i, i + PUSH_BATCH);
    await remote.push(
      batch.map((r) => ({
        rid: r.key,
        body: { k: r.key, v: r.deleted ? null : r.value, o: r.order, t: r.updatedAt, d: r.deleted === 1 } satisfies RecordBody,
        client_updated_at: new Date(r.updatedAt).toISOString(),
        deleted: r.deleted === 1,
      })),
    );
    // Solo se limpia la marca si el registro no volvió a cambiar mientras se subía
    await db.transaction('rw', db.records, async () => {
      for (const r of batch) {
        const now = await db.records.get(r.key);
        if (now && now.updatedAt === r.updatedAt) await db.records.put({ ...now, dirty: 0 });
      }
    });
    pushed += batch.length;
  }
  return pushed;
}

export async function pullRemote(
  db: UserDb,
  remote: Remote,
  legacy?: AccountKeys,
): Promise<{ applied: number; appliedKeys: string[]; unreadable: number }> {
  let cursor: PullCursor = (await metaGet<PullCursor>(db, CURSOR_KEY)) ?? { ts: null, rid: '' };
  const seen = await metaGet<PullCursor>(db, SEEN_KEY);
  const appliedKeys: string[] = [];
  let applied = 0;
  let unreadable = 0;
  let last: PullCursor | null = null;

  for (;;) {
    const rows = await remote.pull(cursor, PULL_PAGE);
    if (!rows.length) break;
    const result = await applyRows(db, rows, legacy);
    applied += result.applied.length;
    appliedKeys.push(...result.applied);
    unreadable += result.unreadable;
    const tail = rows[rows.length - 1];
    cursor = { ts: tail.server_updated_at, rid: tail.rid };
    last = cursor;
    if (rows.length < PULL_PAGE) break;
  }

  // Las filas llegan ordenadas: la última es la más nueva. Si es justo la ya vista, no hubo nada nuevo
  const fresh = last && !(seen && last.ts === seen.ts && last.rid === seen.rid);
  if (last && fresh) {
    // Algo nuevo: se repasa el último minuto en la próxima descarga, una vez
    const safe = new Date(Date.parse(last.ts!) - CURSOR_OVERLAP_MS).toISOString();
    await metaSet(db, CURSOR_KEY, { ts: safe, rid: '' } satisfies PullCursor);
    await metaSet(db, SEEN_KEY, last);
  } else if (seen) {
    // Repaso hecho (o nada que bajar): la próxima descarga empieza justo después de lo último visto
    await metaSet(db, CURSOR_KEY, seen);
  }
  return { applied, appliedKeys, unreadable };
}

const isBody = (b: unknown): b is RecordBody =>
  Boolean(b) && typeof (b as RecordBody).k === 'string' && typeof (b as RecordBody).t === 'number';

async function decode(row: RemoteRow, legacy?: AccountKeys): Promise<RecordBody | null> {
  if (row.body) return isBody(row.body) ? row.body : null;
  if (!row.ciphertext || !legacy) return null;
  try {
    // Formato antiguo: el rid opaco iba como datos asociados del cifrado
    const payload = await openJson<RecordBody>(legacy.encKey, row.ciphertext, row.rid);
    return isBody(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function applyRows(db: UserDb, rows: RemoteRow[], legacy?: AccountKeys) {
  const applied: string[] = [];
  let unreadable = 0;
  const decoded: RecordBody[] = [];
  for (const row of rows) {
    const body = await decode(row, legacy);
    if (body) decoded.push(body);
    else unreadable++;
  }

  await db.transaction('rw', db.records, async () => {
    for (const p of decoded) {
      const local = await db.records.get(p.k);
      if (local && local.updatedAt >= p.t) continue; // lo local es igual o más nuevo
      const rec: LocalRecord = { key: p.k, value: p.d ? null : p.v, order: p.o, updatedAt: p.t, deleted: p.d ? 1 : 0, dirty: 0 };
      await db.records.put(rec);
      applied.push(p.k);
    }
  });
  return { applied, unreadable };
}

/** Sincronización completa: subir lo pendiente y bajar lo nuevo */
export async function syncOnce(db: UserDb, remote: Remote, legacy?: AccountKeys): Promise<SyncResult> {
  const pushed = await pushDirty(db, remote);
  const { applied, appliedKeys, unreadable } = await pullRemote(db, remote, legacy);
  await purgeTombstones(db);
  return { pushed, applied, appliedKeys, unreadable };
}

/**
 * Convierte una cuenta de antes: baja todo (descifrando lo cifrado con las claves antiguas) y vuelve a
 * subirlo legible. Quien llama borra después las filas cifradas en el servidor. Se puede repetir sin riesgo:
 * el servidor ignora un registro si ya tiene una versión igual o más nueva.
 */
export async function migrateLegacy(db: UserDb, remote: Remote, legacy: AccountKeys): Promise<SyncResult> {
  await resetCursor(db);
  const { applied, appliedKeys, unreadable } = await pullRemote(db, remote, legacy);
  await markAllDirty(db);
  const pushed = await pushDirty(db, remote);
  await purgeTombstones(db);
  return { pushed, applied, appliedKeys, unreadable };
}

async function purgeTombstones(db: UserDb) {
  const limit = Date.now() - TOMBSTONE_TTL_MS;
  const old = await db.records.filter((r) => r.deleted === 1 && r.dirty === 0 && r.updatedAt < limit).primaryKeys();
  if (old.length) await db.records.bulkDelete(old);
}

/** Olvida el cursor (para volver a bajar todo) */
export const resetCursor = (db: UserDb) => metaSet(db, CURSOR_KEY, null);

/** Marca todo lo local como pendiente de subir */
export async function markAllDirty(db: UserDb): Promise<void> {
  const all = await db.records.toArray();
  await db.records.bulkPut(all.map((r) => ({ ...r, dirty: 1 as const })));
}
