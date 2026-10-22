import type { AppData } from '@/types';
import { recordOrders, toRecords } from './records';
import type { LocalRecord, UserDb } from './localDb';

/**
 * Datos de una versión anterior (sin cuenta, guardados en este navegador) → base de la cuenta.
 * - `replace`: los datos de este dispositivo sustituyen a los de la cuenta (lo demás se borra).
 * - `merge`: se añaden los elementos que la cuenta no tiene; si existe en ambos, gana la cuenta.
 */
export type LegacyMode = 'replace' | 'merge';

export async function importLegacyData(db: UserDb, data: AppData, mode: LegacyMode): Promise<number> {
  const incoming = toRecords(data);
  const orders = recordOrders(data);
  const existing = await db.records.toArray();
  const live = new Map(existing.filter((r) => !r.deleted).map((r) => [r.key, r]));
  const now = Date.now();
  const stamp = (key: string) => Math.max(now, (live.get(key)?.updatedAt ?? 0) + 1);
  const puts: LocalRecord[] = [];

  for (const [key, value] of incoming) {
    if (mode === 'merge' && live.has(key)) continue;
    puts.push({ key, value: JSON.parse(JSON.stringify(value)), order: orders.get(key), updatedAt: stamp(key), deleted: 0, dirty: 1 });
  }
  if (mode === 'replace') {
    for (const key of live.keys()) {
      if (!incoming.has(key)) puts.push({ key, value: null, updatedAt: stamp(key), deleted: 1, dirty: 1 });
    }
  }
  if (puts.length) await db.records.bulkPut(puts);
  return puts.length;
}
