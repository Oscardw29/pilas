import type { AppData } from '@/types';

/**
 * Validación estructural de un respaldo importado antes de reemplazar los datos.
 * Comprueba tipos de las colecciones principales para que un archivo malformado no rompa las vistas.
 * Los campos de claves de API y el temporizador activo se ignoran al importar (ver importData en el store).
 */

export type BackupValidation = { ok: true; data: AppData; summary: string } | { ok: false; error: string };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const LOG_STATUS = new Set(['full', 'minimum', 'missed', 'partial']);
const HABIT_STATUS = new Set(['active', 'paused', 'archived']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Colecciones opcionales que, si existen, deben ser arrays de objetos */
const OPTIONAL_ARRAYS = [
  'sessions', 'energy', 'challenges', 'experiments', 'relations', 'weeklyReviews', 'checkins', 'habitReviews',
  'rewards', 'redemptions', 'pointEvents', 'conversations', 'streakFreezes',
] as const;

/** Colecciones opcionales que, si existen, deben ser objetos */
const OPTIONAL_RECORDS = ['achievements', 'recommendationFeedback', 'dismissedInsights'] as const;

export function validateBackup(raw: unknown): BackupValidation {
  if (!isObj(raw)) return { ok: false, error: 'El archivo no contiene un objeto JSON.' };

  if (!Array.isArray(raw.habits) || !Array.isArray(raw.goals)) {
    return { ok: false, error: 'Faltan las listas de hábitos u objetivos.' };
  }

  for (const [i, h] of raw.habits.entries()) {
    if (!isObj(h)) return { ok: false, error: `Hábito #${i + 1} no es válido.` };
    if (!isStr(h.id) || !isStr(h.name)) return { ok: false, error: `Hábito #${i + 1}: falta id o nombre.` };
    if (!Array.isArray(h.days) || !h.days.every((d) => isNum(d) && d >= 0 && d <= 6)) {
      return { ok: false, error: `Hábito «${h.name}»: días de la semana no válidos.` };
    }
    if (!isStr(h.createdAt) || !DATE_KEY.test(h.createdAt)) return { ok: false, error: `Hábito «${h.name}»: fecha de creación no válida.` };
    if (h.status !== undefined && !HABIT_STATUS.has(h.status as string)) return { ok: false, error: `Hábito «${h.name}»: estado no válido.` };
    if (h.goals !== undefined && !Array.isArray(h.goals)) return { ok: false, error: `Hábito «${h.name}»: objetivos vinculados no válidos.` };
    if (!isNum(h.points)) return { ok: false, error: `Hábito «${h.name}»: puntos no válidos.` };
  }

  for (const [i, g] of raw.goals.entries()) {
    if (!isObj(g) || !isStr(g.id) || !isStr(g.name)) return { ok: false, error: `Objetivo #${i + 1} no es válido.` };
    if (!isStr(g.startDate) || !DATE_KEY.test(g.startDate)) return { ok: false, error: `Objetivo «${g.name}»: fecha de inicio no válida.` };
  }

  if (raw.logs !== undefined) {
    if (!isObj(raw.logs)) return { ok: false, error: 'El historial de registros no es válido.' };
    for (const l of Object.values(raw.logs)) {
      if (!isObj(l) || !isStr(l.habitId) || !isStr(l.date) || !DATE_KEY.test(l.date) || !LOG_STATUS.has(l.status as string) || !isNum(l.points)) {
        return { ok: false, error: 'Hay registros diarios con formato no válido.' };
      }
    }
  }

  for (const key of OPTIONAL_ARRAYS) {
    const v = raw[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) return { ok: false, error: `La sección «${key}» no es una lista.` };
    const itemsAreStrings = key === 'streakFreezes';
    if (!v.every((x) => (itemsAreStrings ? isStr(x) : isObj(x)))) return { ok: false, error: `La sección «${key}» contiene elementos no válidos.` };
  }
  if (Array.isArray(raw.sessions)) {
    for (const s of raw.sessions as Record<string, unknown>[]) {
      if (!isStr(s.habitId) || !isStr(s.date) || !isNum(s.durationSec)) return { ok: false, error: 'Hay sesiones con formato no válido.' };
    }
  }

  for (const key of OPTIONAL_RECORDS) {
    if (raw[key] !== undefined && !isObj(raw[key])) return { ok: false, error: `La sección «${key}» no es válida.` };
  }
  if (raw.settings !== undefined && !isObj(raw.settings)) return { ok: false, error: 'Los ajustes no son válidos.' };

  const data = raw as unknown as AppData;
  const logs = raw.logs ? Object.keys(raw.logs).length : 0;
  return {
    ok: true,
    data,
    summary: `${data.habits.length} hábitos, ${data.goals.length} objetivos y ${logs} registros`,
  };
}
