/** Lo que dice el coach científico según cómo van los experimentos */

export interface LabBrief {
  name: string;
  day: number;
  durationDays: number;
  /** Días que faltan para empezar; 0 si ya ha empezado */
  startsIn: number;
  /** Preparado, todavía sin arrancar */
  planned: boolean;
  /** El hábito asociado está en pausa */
  paused: boolean;
  /** Variante que va ganando, si no hay empate */
  leader: { label: string; pct: number } | null;
  /** Mejor adherencia entre las variantes */
  topPct: number;
}

/** Índice de la variante que va ganando entre dos (-1 si hay empate) */
export const leaderIndex = (pcts: number[]) => (pcts.length === 2 && pcts[0] !== pcts[1] ? (pcts[0] > pcts[1] ? 0 : 1) : -1);

const short = (name: string) => (name.length > 24 ? `${name.slice(0, 23)}…` : name);

export function scientistLine(briefs: LabBrief[], finished: number, adopted: string | null): string {
  if (adopted) return `¡Hipótesis comprobada! «${short(adopted)}» se queda 🧪`;
  if (briefs.length === 0) {
    if (finished === 0) return '¡Hola! Propón una hipótesis y la ponemos a prueba.';
    return `Ya van ${finished} ${finished === 1 ? 'experimento concluido' : 'experimentos concluidos'}. ¿Probamos otra hipótesis?`;
  }

  const paused = briefs.find((b) => b.paused);
  if (paused) return `«${short(paused.name)}» está en pausa: reanuda el hábito para seguir midiendo.`;

  // El experimento más avanzado es el que tiene algo que contar
  const running = briefs.filter((b) => !b.planned).sort((a, b) => b.day / b.durationDays - a.day / a.durationDays);
  const top = running[0];
  if (!top) {
    const next = [...briefs].sort((a, b) => a.startsIn - b.startsIn)[0];
    if (next.startsIn === 0) return `Todo listo para «${short(next.name)}». ¡Cuando quieras!`;
    return `Todo listo para «${short(next.name)}». Arranca ${next.startsIn === 1 ? 'mañana' : `en ${next.startsIn} días`}.`;
  }

  if (top.day >= top.durationDays && top.topPct > 0) return `«${short(top.name)}» ya tiene datos: elige la variante ganadora.`;
  if (top.leader) return `En «${short(top.name)}» va ganando «${short(top.leader.label)}» con ${top.leader.pct}%.`;
  if (top.topPct > 0) return `«${short(top.name)}» va empatado al ${top.topPct}%. Una sesión más puede decidirlo.`;
  return `Día ${top.day} de ${top.durationDays} en «${short(top.name)}». Faltan datos: registra una sesión.`;
}
