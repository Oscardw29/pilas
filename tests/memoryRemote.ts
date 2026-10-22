import type { PullCursor, PushRow, Remote, RemoteRow } from '@/sync/remote';

/** Servidor en memoria con las mismas reglas que las funciones SQL push_records / pull_records */
export function memoryRemote(): Remote & { rows: Map<string, RemoteRow> } {
  const rows = new Map<string, RemoteRow>();
  let clock = Date.parse('2026-01-01T00:00:00Z');
  return {
    rows,
    async push(batch: PushRow[]) {
      // Como en Postgres: todo el lote comparte la marca de la transacción
      const ts = new Date((clock += 1000)).toISOString();
      for (const r of batch) {
        const prev = rows.get(r.rid);
        if (prev && Date.parse(prev.client_updated_at) >= Date.parse(r.client_updated_at)) continue;
        rows.set(r.rid, { ...r, server_updated_at: ts });
      }
    },
    async pull(after: PullCursor, limit: number) {
      return [...rows.values()]
        .filter((r) => after.ts === null || r.server_updated_at > after.ts || (r.server_updated_at === after.ts && r.rid > after.rid))
        .sort((a, b) =>
          a.server_updated_at === b.server_updated_at ? (a.rid < b.rid ? -1 : 1) : a.server_updated_at < b.server_updated_at ? -1 : 1,
        )
        .slice(0, limit);
    },
  };
}
