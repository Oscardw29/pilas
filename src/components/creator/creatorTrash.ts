import { create } from 'zustand';
import {
  adminDeleteAchievement,
  adminRestoreItem,
  adminSaveAchievement,
  adminSaveEconomyDraft,
  removeCatalogFiles,
} from '@/social/api';
import type { AchievementDef, CatalogItem } from '@/social/types';

/**
 * PAPELERA DEL PANEL DEL CREADOR
 * Lo que se elimina en el panel (logros, artículos del catálogo, borradores de la economía) pasa 24 h aquí: se puede
 * revisar y restaurar tal como estaba. Pasado ese plazo se borra para siempre (al abrir el panel).
 *
 * - Logros: no se borran del servidor hasta que vence el plazo; mientras tanto quedan retirados (active = false) y
 *   ocultos en la lista. Así, al restaurarlos, quien los tenía los conserva con su fecha original.
 * - Artículos del catálogo: la fila se borra al momento (si alguien lo compró el servidor no deja, como antes), pero
 *   sus archivos se quedan hasta que vence el plazo para poder restaurarlo completo.
 * - Borradores de la economía: se borran al momento; restaurar crea un borrador nuevo con los mismos valores.
 *
 * La lista vive en este dispositivo (los datos siguen en el servidor): si borras desde otro equipo, la papelera de
 * ese equipo es la que los guarda.
 */

export const TRASH_TTL_MS = 24 * 60 * 60 * 1000;
const KEY = 'pilas:creator-trash';

interface Base {
  /** Identificador de la entrada (no el del objeto) */
  key: string;
  deletedAt: number;
}
export type TrashEntry =
  | (Base & { kind: 'achievement'; def: AchievementDef })
  | (Base & { kind: 'catalog'; item: CatalogItem })
  | (Base & { kind: 'economyDraft'; version: number; params: Record<string, unknown>; note: string | null });

type NewEntry = TrashEntry extends infer E ? (E extends TrashEntry ? Omit<E, 'key' | 'deletedAt'> : never) : never;

function read(): TrashEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? (list as TrashEntry[]) : [];
  } catch {
    return [];
  }
}
function write(list: TrashEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sin almacenamiento: la papelera dura lo que la sesión */
  }
}

interface TrashState {
  entries: TrashEntry[];
  add: (e: NewEntry) => void;
  drop: (key: string) => void;
}

export const useCreatorTrash = create<TrashState>()((set, get) => ({
  entries: read(),
  add: (e) => {
    const entry = { ...e, key: `${e.kind}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`, deletedAt: Date.now() } as TrashEntry;
    const entries = [entry, ...get().entries];
    write(entries);
    set({ entries });
  },
  drop: (key) => {
    const entries = get().entries.filter((x) => x.key !== key);
    write(entries);
    set({ entries });
  },
}));

export const expiresAt = (e: TrashEntry) => e.deletedAt + TRASH_TTL_MS;

/** Ids de logros que están en la papelera (siguen en el servidor, retirados) */
export const trashedAchievementIds = (entries: TrashEntry[]) =>
  new Set(entries.filter((e): e is Extract<TrashEntry, { kind: 'achievement' }> => e.kind === 'achievement').map((e) => e.def.id));

/** Elimina un logro: queda retirado y en la papelera (el borrado real llega a las 24 h) */
export async function trashAchievement(def: AchievementDef) {
  if (def.active) await adminSaveAchievement({ ...def, active: false }, false);
  useCreatorTrash.getState().add({ kind: 'achievement', def });
}

/** Restaura una entrada tal como estaba */
export async function restoreEntry(e: TrashEntry) {
  if (e.kind === 'achievement') await adminSaveAchievement(e.def, false);
  else if (e.kind === 'catalog') await adminRestoreItem(e.item);
  else await adminSaveEconomyDraft(e.params, e.note ? `${e.note} (restaurado)` : `Restaurado de la v${e.version}`);
  useCreatorTrash.getState().drop(e.key);
}

/** Borra para siempre una entrada (lo que quedaba en el servidor) */
export async function purgeEntry(e: TrashEntry) {
  if (e.kind === 'achievement') await adminDeleteAchievement(e.def.id);
  else if (e.kind === 'catalog') await removeCatalogFiles([e.item.asset_path ?? '', e.item.thumb_path ?? '']).catch(() => undefined);
  useCreatorTrash.getState().drop(e.key);
}

let purging = false;
/** Borra para siempre lo que lleva más de 24 h en la papelera. Lo llama el panel al abrirse */
export async function purgeExpired(now = Date.now()): Promise<number> {
  if (purging) return 0;
  purging = true;
  let n = 0;
  try {
    for (const e of useCreatorTrash.getState().entries.filter((x) => expiresAt(x) <= now)) {
      try {
        await purgeEntry(e);
        n++;
      } catch {
        /* sin conexión o sin permiso: se reintenta la próxima vez */
      }
    }
  } finally {
    purging = false;
  }
  return n;
}

/**
 * Logros que crea la migración 0002 (supabase/migrations/0002_social.sql). Si alguno falta en el servidor (p. ej. se
 * borró antes de que existiera la papelera), la papelera ofrece volver a crearlo con un toque.
 */
export const DEFAULT_ACHIEVEMENTS: AchievementDef[] = (
  [
    ['chispa', 'Chispa', 'Racha de 3 días', '🔥', 'common', 'streak', 3, 10],
    ['semana_encendida', 'Semana encendida', 'Racha de 7 días', '🔥', 'common', 'streak', 7, 11],
    ['diez_de_diez', 'Diez de diez', 'Racha de 10 días', '🔥', 'common', 'streak', 10, 12],
    ['mes_imparable', 'Un mes imparable', 'Racha de 30 días', '🔥', 'rare', 'streak', 30, 13],
    ['dos_meses', 'Dos meses de fuego', 'Racha de 60 días', '🔥', 'rare', 'streak', 60, 14],
    ['centenario', 'Centenario', 'Racha de 100 días', '🔥', 'epic', 'streak', 100, 15],
    ['anio_entero', 'Un año entero', 'Racha de 365 días', '🔥', 'legendary', 'streak', 365, 16],
    ['primeros_mil', 'Primeros mil', '1 000 XP en total', '⚡', 'common', 'xp_total', 1000, 20],
    ['diez_mil', 'Diez mil', '10 000 XP en total', '⚡', 'rare', 'xp_total', 10000, 21],
    ['leyenda', 'Leyenda de la constancia', '50 000 XP en total', '⚡', 'epic', 'xp_total', 50000, 22],
    ['primer_gasto', 'Primer gasto', 'Gastar 100 monedas', '🪙', 'common', 'coins_spent', 100, 30],
    ['buen_cliente', 'Buen cliente', 'Gastar 1 000 monedas', '🪙', 'rare', 'coins_spent', 1000, 31],
    ['campeon', 'Campeón de la semana', 'Quedar 1.º en el ranking semanal', '🥇', 'epic', 'podium_1', 1, 40],
    ['subcampeon', 'Subcampeón', 'Quedar 2.º en el ranking semanal', '🥈', 'rare', 'podium_2', 1, 41],
    ['en_el_podio', 'En el podio', 'Quedar 3.º en el ranking semanal', '🥉', 'rare', 'podium_3', 1, 42],
    ['tricampeon', 'Tricampeón', 'Quedar 1.º en tres semanas distintas', '🏆', 'legendary', 'podium_1', 3, 43],
    ['ascenso', 'Ascenso', 'Subir de liga por primera vez', '🛡️', 'common', 'promotions', 1, 50],
    ['diamante', 'Diamante', 'Llegar a la liga Diamante', '💎', 'epic', 'league_max', 5, 51],
    ['semana_perfecta', 'Semana perfecta', 'Cumplir todos los hábitos programados de una semana', '✅', 'rare', 'perfect_weeks', 1, 60],
    ['cinco_perfectas', 'Cinco semanas perfectas', 'Cinco semanas perfectas, no necesariamente seguidas', '✅', 'epic', 'perfect_weeks', 5, 61],
    ['cien_habitos', 'Cien hábitos', '100 hábitos cumplidos', '📈', 'common', 'habits_done', 100, 70],
    ['buena_compania', 'Buena compañía', 'Tener 5 amigos', '🤝', 'common', 'friends', 5, 80],
    ['primera_publicacion', 'Primera publicación', 'Publicar por primera vez', '📣', 'common', 'posts', 1, 81],
    ['animador', 'Animador', 'Enviar ánimos 10 veces', '💬', 'common', 'cheers_sent', 10, 82],
    ['con_estilo', 'Con estilo', 'Comprar el primer cosmético', '🎨', 'common', 'cosmetics', 1, 90],
  ] as const
).map(([id, name, description, icon, rarity, metric, threshold, sort]) => ({
  id,
  name,
  description,
  icon,
  rarity,
  metric,
  threshold,
  sort,
  prize: 0,
  active: true,
})) as AchievementDef[];
