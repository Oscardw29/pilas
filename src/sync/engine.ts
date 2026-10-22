import type { AccountKeys } from '@/crypto/keys';
import { opaqueId, openJson, sealJson } from '@/crypto/keys';
import { metaGet, metaSet, type LocalRecord, type UserDb } from '@/db/localDb';
import type { PullCursor, Remote, RemoteRow } from './remote';

/**
 * MOTOR DE SINCRONIZACIÓN
 * - Subida: los registros locales marcados `dirty` se cifran y se envían en lotes.
 * - Bajada: se piden los registros que el servidor recibió después del último cursor, se descifran
 *   y se aplican. Si el mismo registro cambió en dos sitios gana el cambio más reciente
 *   (last-write-wins por registro).
 * Es independiente de Supabase y de React: recibe la base local, las claves y el transporte.
 */

const PUSH_BATCH = 200;
const PULL_PAGE = 500;
/**
 * El cursor se retrasa un poco: una escritura que empezó antes en el servidor pero terminó después
 * de una descarga podría tener una marca anterior al cursor. Reaplicar registros no hace daño.
 */
const CURSOR_OVERLAP_MS = 60_000;
const CURSOR_KEY = 'sync:cursor';
/** Lápidas ya subidas que se pueden olvidar en local */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

interface Payload {
  k: string;
  v: unknown;
  o?: number;
}

export interface SyncResult {
  pushed: number;
  /** Registros de otros dispositivos aplicados en local */
  applied: number;
  /** Registros que no se pudieron descifrar (otra clave de cuenta) */
  undecryptable: number;
}

export async function pushDirty(db: UserDb, keys: AccountKeys, remote: Remote): Promise<number> {
  const dirty = await db.records.where('dirty').equals(1).toArray();
  let pushed = 0;
  for (let i = 0; i < dirty.length; i += PUSH_BATCH) {
    const batch = dirty.slice(i, i + PUSH_BATCH);
    const rows = await Promise.all(
      batch.map(async (r) => ({
        rid: await opaqueId(keys.ridKey, r.key),
        ciphertext: await sealJson(keys.encKey, { k: r.key, v: r.deleted ? null : r.value, o: r.order } satisfies Payload),
        client_updated_at: new Date(r.updatedAt).toISOString(),
        deleted: r.deleted === 1,
      })),
    );
    await remote.push(rows);
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

export async function pullRemote(db: UserDb, keys: AccountKeys, remote: Remote): Promise<{ applied: number; undecryptable: number }> {
  let cursor: PullCursor = (await metaGet<PullCursor>(db, CURSOR_KEY)) ?? { ts: null, rid: '' };
  let applied = 0;
  let undecryptable = 0;
  let newest: string | null = null;

  for (;;) {
    const rows = await remote.pull(cursor, PULL_PAGE);
    if (!rows.length) break;
    const result = await applyRows(db, keys, rows);
    applied += result.applied;
    undecryptable += result.undecryptable;
    const last = rows[rows.length - 1];
    cursor = { ts: last.server_updated_at, rid: last.rid };
    newest = last.server_updated_at;
    if (rows.length < PULL_PAGE) break;
  }

  if (newest) {
    const safe = new Date(Date.parse(newest) - CURSOR_OVERLAP_MS).toISOString();
    await metaSet(db, CURSOR_KEY, { ts: safe, rid: '' } satisfies PullCursor);
  }
  return { applied, undecryptable };
}

async function applyRows(db: UserDb, keys: AccountKeys, rows: RemoteRow[]) {
  let applied = 0;
  let undecryptable = 0;
  const decoded: { row: RemoteRow; payload: Payload }[] = [];
  for (const row of rows) {
    try {
      decoded.push({ row, payload: await openJson<Payload>(keys.encKey, row.ciphertext) });
    } catch {
      undecryptable++;
    }
  }

  await db.transaction('rw', db.records, async () => {
    for (const { row, payload } of decoded) {
      const remoteTs = Date.parse(row.client_updated_at);
      const local = await db.records.get(payload.k);
      if (local && local.updatedAt >= remoteTs) continue; // lo local es igual o más nuevo
      const rec: LocalRecord = {
        key: payload.k,
        value: row.deleted ? null : payload.v,
        order: payload.o,
        updatedAt: remoteTs,
        deleted: row.deleted ? 1 : 0,
        dirty: 0,
      };
      await db.records.put(rec);
      applied++;
    }
  });
  return { applied, undecryptable };
}

/** Sincronización completa: subir lo pendiente y bajar lo nuevo */
export async function syncOnce(db: UserDb, keys: AccountKeys, remote: Remote): Promise<SyncResult> {
  const pushed = await pushDirty(db, keys, remote);
  const { applied, undecryptable } = await pullRemote(db, keys, remote);
  await purgeTombstones(db);
  return { pushed, applied, undecryptable };
}

async function purgeTombstones(db: UserDb) {
  const limit = Date.now() - TOMBSTONE_TTL_MS;
  const old = await db.records.filter((r) => r.deleted === 1 && r.dirty === 0 && r.updatedAt < limit).primaryKeys();
  if (old.length) await db.records.bulkDelete(old);
}

/** Olvida el cursor (tras restablecer los datos de la nube hay que volver a bajar todo) */
export const resetCursor = (db: UserDb) => metaSet(db, CURSOR_KEY, null);
