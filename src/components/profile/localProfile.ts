import type { AppData, DateKey } from '@/types';
import { addDaysKey } from '@/lib/dates';
import { publicHabitRows } from '@/social/publish';
import type { PublicHabit } from '@/social/types';

/**
 * PERFIL CON LOS DATOS DEL DISPOSITIVO
 * Lo que se ve en el perfil propio cuando las cifras no vienen del servidor: en modo demostración (no se publica nada),
 * sin conexión o mientras el servidor no tiene la capa pública. Usa las mismas reglas que lo que se publica
 * (social/publish.ts), así la vista local y la pública coinciden.
 */

/**
 * Hábitos marcados como visibles con su cumplimiento en la semana que empieza en `weekStart` (lunes).
 * Se calcula como si «hoy» fuera el lunes siguiente (o el hoy real, si la semana es la actual) para que los días
 * pasados sin registro cuenten como no realizados, igual que en lo publicado.
 */
export function localWeekHabits(data: Pick<AppData, 'habits' | 'logs'>, weekStart: DateKey, today: DateKey): PublicHabit[] {
  const nextMonday = addDaysKey(weekStart, 7);
  const ref = nextMonday < today ? nextMonday : today;
  return publicHabitRows(data, ref, 'local').map((r) => ({
    key: r.habit_key,
    name: r.name,
    icon: r.icon,
    kind: r.kind as PublicHabit['kind'],
    unit: r.unit,
    target: r.target ?? null,
    days: r.days as PublicHabit['days'],
  }));
}
