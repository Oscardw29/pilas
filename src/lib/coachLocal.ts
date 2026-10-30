import type { AppData, DateKey, Habit, TimeOfDay } from '@/types';
import {
  bestStreak, calculateGlobalStreak, consistency, currentStreak, getLog, isDoneLog, isScheduled, levelFromXp, recoveryStats, weekSummary,
} from './metrics';
import { economySummary } from './economy';
import { addDaysKey, DAY_LONG, shortDate, startOfWeekKey, todayKey, weekdayIndex } from './dates';
import { FAIL_REASON_LABELS } from './insights';
import { MAX_ACTIVE_HABITS } from './limits';
import { getCoachPersona, type CoachGender } from '@/components/coach/coachPersona';
import { phraseText, pickPhrase } from './coachPhrases';

/**
 * MOTOR DE RESPUESTAS LOCAL DEL COACH (sin IA)
 * Responde cuando no hay clave de IA (o cuando la IA falla). Detecta la intención del mensaje con palabras
 * clave y arma la respuesta con dos tipos de líneas:
 * - Frases fijas del catálogo (lib/coachPhrases): van solas en su línea para que, si existe su audio grabado,
 *   el coach las diga con su voz aunque no haya clave de TTS (lib/coachVoice).
 * - Datos reales de la persona (racha, pendientes de hoy, XP, constancia…): se escriben, y solo se leen en voz
 *   alta si hay una voz de TTS configurada.
 * Solo cita cifras calculadas a partir de los datos; el resto son pautas generales presentadas como tales.
 */

type Intent =
  | 'accion' | 'saludo' | 'despedida' | 'gracias' | 'ayuda'
  | 'recaida' | 'estres' | 'cansancio' | 'motivacion' | 'procrastinacion'
  | 'app_tema' | 'app_voz' | 'app_ligas' | 'app_logros' | 'app_comunidad' | 'app_perfil' | 'app_tienda'
  | 'app_temporizador' | 'app_experimentos' | 'app_mapa' | 'app_revision' | 'app_retos' | 'app_insights'
  | 'app_calendario' | 'app_habitos' | 'app_registrar' | 'app_objetivos' | 'xp'
  | 'comparar' | 'sueno' | 'ejercicio' | 'estudio' | 'minimo' | 'racha' | 'ahora' | 'organizar'
  | 'primer' | 'hallazgo' | 'dificil' | 'progreso' | 'objetivos' | 'general';

interface Ctx {
  data: AppData;
  ref: DateKey;
  gender: CoachGender;
  name: string;
  hour: number;
  /** Hábitos activos */
  active: Habit[];
  /** Activos programados hoy */
  today: Habit[];
  /** Programados hoy y aún sin hacer, en el orden en que conviene hacerlos */
  pending: Habit[];
  /** Programados hoy y ya hechos (completo o mínimo) */
  done: Habit[];
  /** Texto del mensaje en minúsculas y sin tildes */
  n: string;
}

/* ---------------- Utilidades ---------------- */

/** Minúsculas y sin tildes («Programación» → «programacion»); la ñ pasa a n */
const nrm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const bold = (h: Habit) => `**${h.icon} ${h.name}**`;
/** Un decimal con coma y sin «,0» (3 días, 2,5 días) */
const dec1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
/** Las etiquetas de meta y mínimo van a mitad de frase: «Antes de las 23:00» → «antes de las 23:00» */
const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const TIME_LABEL: Record<TimeOfDay, string> = { morning: 'Mañana', afternoon: 'Tarde', evening: 'Noche', any: 'Cuando puedas' };
const TIME_ORDER: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'any'];
const bucketOf = (hour: number): TimeOfDay => (hour < 12 ? 'morning' : hour < 19 ? 'afternoon' : 'evening');

/** Meta del hábito en texto («20 min», «10 reps», «20 páginas» o «hecho») */
function targetText(h: Habit): string {
  if (h.kind === 'quantity' && h.targetQuantity) return `${h.targetQuantity} ${h.quantityUnit ?? ''}`.trim();
  if (h.targetMinutes && h.kind !== 'action') return `${h.targetMinutes} min`;
  return h.targetLabel ? lcFirst(h.targetLabel) : 'hecho';
}

/** Versión mínima en texto; si no está definida, la parte proporcional de la meta */
function minimumText(h: Habit, ratio: number): string {
  if (h.kind === 'quantity' && h.targetQuantity) {
    return `${h.minimumQuantity ?? Math.max(1, Math.round(h.targetQuantity * ratio))} ${h.quantityUnit ?? ''}`.trim();
  }
  if (h.targetMinutes && h.kind !== 'action') return `${h.minimumMinutes ?? Math.max(1, Math.round(h.targetMinutes * ratio))} min`;
  return h.minimumLabel ? lcFirst(h.minimumLabel) : 'una versión corta';
}

/** Constancia de 30 días de cada hábito activo con datos, de mayor a menor */
function rankedConsistency(ctx: Ctx): { habit: Habit; value: number }[] {
  return ctx.active
    .map((habit) => ({ habit, value: consistency(ctx.data, habit, 30, ctx.ref) }))
    .filter((x): x is { habit: Habit; value: number } => x.value != null)
    .sort((a, b) => b.value - a.value);
}

function averageConsistency(ctx: Ctx): number | null {
  const list = rankedConsistency(ctx);
  return list.length ? list.reduce((a, x) => a + x.value, 0) / list.length : null;
}

/** Razón de fallo más registrada (opcionalmente de un hábito) */
function topFailReason(ctx: Ctx, habitId?: string): { label: string; count: number } | null {
  const counts: Record<string, number> = {};
  for (const l of Object.values(ctx.data.logs)) {
    if (l.status !== 'missed' || !l.failReason || (habitId && l.habitId !== habitId)) continue;
    counts[l.failReason] = (counts[l.failReason] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  return { label: FAIL_REASON_LABELS[top[0] as keyof typeof FAIL_REASON_LABELS] ?? top[0], count: top[1] };
}

const streakOf = (ctx: Ctx) => calculateGlobalStreak(ctx.data, ctx.ref);
const economyOf = (ctx: Ctx) => economySummary(ctx.data, ctx.ref);

/** Hábitos activos cuyo nombre encaja con el patrón (para ejercicio, estudio, sueño…) */
const habitsMatching = (ctx: Ctx, re: RegExp) => ctx.active.filter((h) => re.test(nrm(h.name)));

/** Hábitos activos que el mensaje nombra (por su nombre completo o por una palabra larga de él) */
function mentionedHabits(ctx: Ctx): Habit[] {
  return ctx.active.filter((h) => {
    const name = nrm(h.name).trim();
    if (name && ctx.n.includes(name)) return true;
    return name
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5)
      .some((w) => new RegExp(`\\b${w}`).test(ctx.n));
  });
}

/** Hábitos que el mensaje compara: los que nombra y, si menciona dos temas (ejercicio, estudio, sueño), los de esos temas */
function comparedHabits(ctx: Ctx): Habit[] {
  const set = new Set(mentionedHabits(ctx));
  const topics = [EXERCISE_RE, STUDY_RE, SLEEP_RE].filter((re) => re.test(ctx.n));
  if (topics.length >= 2) for (const re of topics) habitsMatching(ctx, re).forEach((h) => set.add(h));
  return [...set];
}

const EXERCISE_RE = /ejercicio|entren|gym|gimnasio|correr|caminar|trotar|deporte|yoga|pesas|bici|nadar|cardio|futbol|pilates|crossfit|estirar|flexiones|abdominal/;
const STUDY_RE = /estudi|leer|lectura|libro|idioma|ingles|curso|aprend|program|repas|tarea|examen|escrib|practicar/;
const SLEEP_RE = /dormir|duerm|sueno|insomnio|acostar|despert|madrug|descans|siesta|pantalla/;

function buildCtx(data: AppData, prompt: string, ref: DateKey): Ctx {
  const active = data.habits.filter((h) => h.status === 'active');
  const today = active.filter((h) => isScheduled(h, ref));
  const done = today.filter((h) => isDoneLog(getLog(data, h.id, ref)));
  const hour = new Date().getHours();
  const now = bucketOf(hour);
  // Primero lo que toca a esta hora, luego lo atrasado, después «cuando puedas» y lo de más tarde; a igual franja, más prioridad
  const rank = (h: Habit) => {
    if (h.preferredTime === now) return 0;
    if (h.preferredTime === 'any') return 2;
    return TIME_ORDER.indexOf(h.preferredTime) < TIME_ORDER.indexOf(now) ? 1 : 3;
  };
  const pending = today
    .filter((h) => !done.includes(h))
    .sort((a, b) => rank(a) - rank(b) || b.priority - a.priority);
  return {
    data,
    ref,
    gender: getCoachPersona(data.settings).gender,
    name: data.settings.userName?.trim() || '',
    hour,
    active,
    today,
    pending,
    done,
    n: nrm(prompt),
  };
}

/* ---------------- Detección de la intención ---------------- */

const GREETING_RE = /^(hola+|holi|hey|ey|buenas|buenos dias|buen dia|buenas tardes|buenas noches|que tal|que onda|saludos)\b[\s,.!¡¿?]*/;
const HOW_RE = /\b(como|donde|que es|para que|sirve|funciona|puedo|se puede|explica|cuantos|cuantas)\b/;
/** Mensaje que envía la tarjeta de una propuesta al aceptarla o rechazarla (lib/coachActions: coachChoiceMessage) */
const CHOICE_RE = /\b(acepte|rechace) tu propuesta\b/;

function detectIntent(ctx: Ctx): Intent {
  const full = ctx.n.trim();
  if (CHOICE_RE.test(full)) return 'accion';

  // Saludo: solo si apenas hay algo más; si no, se responde a lo que viene detrás («hola, ¿qué hago ahora?»)
  const greeting = GREETING_RE.test(full);
  const n = greeting ? full.replace(GREETING_RE, '').trim() : full;
  if (greeting && words(n) <= 2) return 'saludo';

  if (words(n) <= 6 && /^(muchas |mil )?gracias\b|\bte lo agradezco\b|^(genial|perfecto|excelente|buenisimo|vale|listo|ok)\b.*gracias/.test(n)) return 'gracias';
  if (words(n) <= 8 && /\b(adios|chao|chau|bye|hasta luego|hasta manana|hasta pronto|nos vemos|me voy|me despido)\b/.test(n)) return 'despedida';

  // Frases de la app que podrían confundirse con estados de ánimo («enviar ánimos»)
  if (/\b(enviar|mandar|dar) animos\b/.test(n)) return 'app_comunidad';

  // Cómo se siente la persona: va antes que cualquier tema
  if (/\b(falle|me falle|recai|recaida|lo deje|deje de|abandone|perdi (la |mi )?racha|rompi (la |mi )?racha|se me corto|dia malo|mal dia|dia horrible|dia terrible|no pude|no cumpli|me salte|volvi a fallar|fracas)/.test(n)) return 'recaida';
  if (/\b(estres|estresad|ansiedad|ansios|agobi|abrumad|saturad|colapsad|presionad|nervios)/.test(n)) return 'estres';
  if (/\b(cansad|agotad|sin fuerzas|sin energia|exhaust|fatiga|rendid|no doy mas)/.test(n)) return 'cansancio';
  if (/\b(motiva|desmotiva|sin ganas|no tengo ganas|desanim|animo|flojera|me rindo|rendirme|inspira)/.test(n)) return 'motivacion';
  if (/\b(procrastin|posterg|dejo para despues|dejarlo para|pereza|me cuesta empezar|no arranco|no empiezo|aplaz)/.test(n)) return 'procrastinacion';

  // Cómo usar la app
  if (/\b(modo claro|modo oscuro|tema claro|tema oscuro|modo noche|modo nocturno|dark mode|apariencia)/.test(n)) return 'app_tema';
  if (/\b(tu voz|la voz|voz del coach|que hables|hablar en voz|leer en voz|en voz alta|silenci|no te escucho|no te oigo|no suenas|no hablas)/.test(n)) return 'app_voz';
  if (/\b(liga|ligas|clasificacion|clasificaciones|ranking|podio|bronce|diamante)\b/.test(n)) return 'app_ligas';
  if (/\b(logro|logros|insignia|medalla)/.test(n)) return 'app_logros';
  if (/\b(amig|comunidad|publica|alias|seguidores|reaccion)/.test(n)) return 'app_comunidad';
  if (/\b(perfil|avatar|foto de perfil|cambiar (mi )?nombre)/.test(n)) return 'app_perfil';
  if (/\b(tienda|recompensa|canje|premio|multiplicador)|que hago con (mis )?monedas|gastar (mis )?monedas/.test(n)) return 'app_tienda';
  if (/\b(temporizador|timer|cronometr|pomodoro|sesion de enfoque)/.test(n)) return 'app_temporizador';
  if (/\b(experimento|laboratorio|a\/b)/.test(n)) return 'app_experimentos';
  if (/\b(mapa|conexion|conectar habitos)/.test(n)) return 'app_mapa';
  if (/\brevision\b/.test(n)) return 'app_revision';
  if (/\b(reto|retos|desafio)/.test(n)) return 'app_retos';
  if (/\binsights?\b/.test(n)) return 'app_insights';
  if (/\b(calendario|historial)\b/.test(n)) return 'app_calendario';
  if (/\b(xp|experiencia|nivel|monedas|puntos)\b/.test(n)) return 'xp';
  if (HOW_RE.test(n) && /habito/.test(n) && /\b(registr|marc)/.test(n)) return 'app_registrar';
  if (HOW_RE.test(n) && /habito/.test(n) && /\b(crear|creo|anad|agreg|edit|borr|elimin|paus|archiv|cuantos|limite|maximo)/.test(n)) return 'app_habitos';
  if (HOW_RE.test(n) && /\b(objetivo|meta)/.test(n) && /\b(crear|creo|anad|agreg|edit|conect|vincul)/.test(n)) return 'app_objetivos';
  if (/\b(que puedes hacer|que sabes hacer|en que me (puedes )?ayudar|como me ayudas|quien eres|que eres|como funcionas)\b|^ayuda\b/.test(n)) return 'ayuda';

  // Temas de hábitos
  if (/\b(mas|menos|vs|versus|compar|mejor|peor|diferencia)\b/.test(n) && comparedHabits(ctx).length >= 2) return 'comparar';
  if (SLEEP_RE.test(n) && !/\bmejor hora\b/.test(n)) return 'sueno';
  if (EXERCISE_RE.test(n)) return 'ejercicio';
  if (/\b(estudi|examen|concentra|foco|enfoc|aprend|lectura|leer mas)/.test(n)) return 'estudio';
  if (/\b(minim[oa]s?|poco tiempo|sin tiempo|no tengo tiempo|no me da el tiempo|apurad)/.test(n)) return 'minimo';
  if (/\b(racha|streak|protector|salvar el dia|salvo el dia|congelar)/.test(n)) return 'racha';
  if (/\b(primer habito|soy nuev|recien empiezo|empezar de cero|nuevo en la app|que habitos me recomiendas|dos minutos|2 minutos|quiero mejorar algo)/.test(n)) return 'primer';
  if (/\b(que hago|que deberia hacer|que me toca|que sigue|siguiente paso|ahora mismo|por donde empiezo|que hacer hoy|pendiente|me quedan)/.test(n)) return 'ahora';
  if (/\b(organiz|planific|plan del dia|plan de hoy|plan para hoy|estructur|agenda|horario|mi dia|ordenar mi)/.test(n)) return 'organizar';
  if (/\b(encontraste|hallazgo|observacion|curioso|que viste|querias decirme|esa idea|una idea|mejora concreta|impacto|que cambio|mejor hora|mejor momento|a que hora|patron)/.test(n)) return 'hallazgo';
  if (/\b(me cuesta|cuesta mas|dificil|por que fallo|por que no cumplo|se me complica|no logro|razones de|motivos de|obstaculo|abandono)/.test(n)) return 'dificil';
  if (/\b(resum|progreso|como voy|como vamos|como me va|estadistic|mi semana|balance|numeros|rendimiento)/.test(n)) return 'progreso';
  if (/\b(objetivo|meta|prioridad)/.test(n)) return 'objetivos';
  return 'general';
}

/* ---------------- Respuestas ---------------- */

/** Párrafos de la respuesta; las frases del catálogo siempre van solas en su línea */
type Out = string[];
const bullets = (list: string[]) => list.map((l) => `• ${l}`).join('\n');

/** Bloque de acción propuesta (la vista muestra la tarjeta de confirmación; no se lee en voz alta) */
const actionBlock = (action: string, data: Record<string, unknown>) =>
  `\`\`\`action\n${JSON.stringify({ action, data }, null, 2)}\n\`\`\``;

function lineStreakAtRisk(ctx: Ctx): string | null {
  const s = streakOf(ctx);
  if (s.streak > 0 && !s.todayHasStreak) return `Tu racha de **${plural(s.streak, 'día', 'días')}** depende de hoy: con un hábito basta.`;
  return null;
}

function replyAccion(ctx: Ctx): Out {
  const accepted = /\bacepte tu propuesta\b/.test(ctx.n);
  const out: Out = [pickPhrase(accepted ? 'accion.aceptada' : 'accion.rechazada', ctx.gender)];
  if (accepted && ctx.pending.length) out.push(`Cuando quieras, seguimos con ${bold(ctx.pending[0])}, que te queda pendiente hoy.`);
  return out;
}

function replySaludo(ctx: Ctx): Out {
  const g = ctx.gender;
  const byWords = /buenos dias|buen dia/.test(ctx.n) ? 'manana' : /buenas tardes/.test(ctx.n) ? 'tarde' : /buenas noches/.test(ctx.n) ? 'noche' : null;
  const byHour = ctx.hour >= 5 && ctx.hour < 12 ? 'manana' : ctx.hour >= 12 && ctx.hour < 19 ? 'tarde' : 'noche';
  const group = byWords ?? (Math.random() < 0.5 ? byHour : 'apertura');
  const out: Out = [pickPhrase(`saludo.${group}`, g)];

  const who = ctx.name ? `, ${ctx.name}` : '';
  const s = streakOf(ctx);
  if (!ctx.active.length) {
    out.push(`Todavía no tienes hábitos activos${who}. Si quieres, te ayudo a elegir el primero.`);
  } else if (!ctx.today.length) {
    out.push(`Hoy no tienes hábitos programados${who}.${s.streak > 0 ? ` Tu racha va en **${plural(s.streak, 'día', 'días')}**.` : ''}`);
  } else if (!ctx.pending.length) {
    out.push(`Hoy ya completaste tus ${plural(ctx.today.length, 'hábito', 'hábitos')}${who}. ¡Día redondo!`);
  } else {
    const names = ctx.pending.slice(0, 3).map(bold).join(', ');
    out.push(`Hoy llevas ${ctx.done.length} de ${ctx.today.length}${who}. Te ${ctx.pending.length === 1 ? 'queda' : 'quedan'}: ${names}${ctx.pending.length > 3 ? '…' : '.'}`);
  }
  out.push(pickPhrase('saludo.pregunta', g));
  return out;
}

function replyDespedida(ctx: Ctx): Out {
  const night = ctx.hour >= 20 || ctx.hour < 4 || /buenas noches|hasta manana|a dormir/.test(ctx.n);
  const out: Out = [pickPhrase(night ? 'despedida.noche' : 'despedida.normal', ctx.gender)];
  if (ctx.pending.length && ctx.hour < 23) {
    out.push(`Antes de irte: te ${ctx.pending.length === 1 ? 'queda' : 'quedan'} ${plural(ctx.pending.length, 'hábito', 'hábitos')} hoy. Con su versión mínima ya cuidas tu racha.`);
  }
  return out;
}

function replyAyuda(ctx: Ctx): Out {
  const g = ctx.gender;
  return [
    phraseText('ayuda.intro', g),
    bullets(['ahora', 'racha', 'analisis', 'consejos', 'app', 'acciones'].map((k) => phraseText(`ayuda.item.${k}`, g))),
    phraseText('ayuda.cierre', g),
  ];
}

function replyAhora(ctx: Ctx): Out {
  const g = ctx.gender;
  if (!ctx.active.length) return replyPrimer(ctx);
  if (!ctx.today.length) return [phraseText('ahora.sin_programar.1', g)];
  if (!ctx.pending.length) {
    const s = streakOf(ctx);
    const out: Out = [pickPhrase('ahora.todo_hecho', g)];
    if (s.streak > 0) out.push(`Tu racha va en **${plural(s.streak, 'día', 'días')}**${s.todayIsSuper ? ' y hoy es súper racha' : ''}.`);
    return out;
  }
  const ratio = ctx.data.settings.minimumRatio;
  const [first, ...rest] = ctx.pending;
  const out: Out = [pickPhrase('ahora.apertura', g)];
  out.push(`Empieza por ${bold(first)}: meta ${targetText(first)}, mínimo ${minimumText(first, ratio)}.`);
  if (rest.length) out.push(`Después: ${rest.slice(0, 3).map(bold).join(', ')}${rest.length > 3 ? '…' : '.'}`);
  const risk = lineStreakAtRisk(ctx);
  if (risk) out.push(risk);
  out.push(pickPhrase('ahora.cierre', g));
  return out;
}

function replyOrganizar(ctx: Ctx): Out {
  const g = ctx.gender;
  if (!ctx.active.length) return replyPrimer(ctx);
  if (!ctx.today.length) return [phraseText('ahora.sin_programar.1', g)];
  const blocks = TIME_ORDER.map((t) => {
    const list = ctx.today.filter((h) => h.preferredTime === t);
    if (!list.length) return null;
    const items = list.map((h) => `${h.icon} ${h.name} (${targetText(h)})${ctx.done.includes(h) ? ' ✓' : ''}`).join(', ');
    return `**${TIME_LABEL[t]}:** ${items}`;
  }).filter((b): b is string => b !== null);
  const out: Out = [pickPhrase('organizar.apertura', g), bullets(blocks)];
  if (ctx.done.length) out.push(`Ya llevas ${ctx.done.length} de ${ctx.today.length}: lo marcado con ✓ está hecho.`);
  out.push(pickPhrase('organizar.cierre', g));
  return out;
}

function replyRacha(ctx: Ctx): Out {
  const g = ctx.gender;
  const s = streakOf(ctx);
  const out: Out = [pickPhrase('racha.apertura', g)];
  const facts: string[] = [];
  if (s.streak > 0) facts.push(`Llevas **${plural(s.streak, 'día', 'días')}** de racha${s.isSuperStreak ? ' (súper racha)' : s.isFrozen ? ' (protegida con el protector)' : ''}.`);
  if (s.todayScheduledCount > 0) facts.push(`Hoy: ${s.todayCompletedCount} de ${s.todayScheduledCount} hábitos hechos.`);
  const top = ctx.active
    .map((h) => ({ h, cur: currentStreak(ctx.data, h, ctx.ref) }))
    .sort((a, b) => b.cur - a.cur)[0];
  if (top && top.cur >= 2) facts.push(`Tu hábito con más días seguidos ahora es ${bold(top.h)}: ${top.cur} días.`);
  if (ctx.data.hasStreakFreeze) facts.push('Tienes un protector de racha guardado.');
  if (facts.length) out.push(bullets(facts));

  if (s.streak === 0 && !s.todayHasStreak) out.push(pickPhrase('racha.cero', g));
  else if (!s.todayHasStreak) out.push(pickPhrase('racha.riesgo', g));
  else out.push(pickPhrase('racha.segura', g));

  out.push(/protector|congelar/.test(ctx.n) ? phraseText('racha.cierre.1', g) : pickPhrase('racha.cierre', g));
  return out;
}

function replyRecaida(ctx: Ctx): Out {
  const g = ctx.gender;
  const out: Out = [pickPhrase('recaida.apertura', g)];
  const facts: string[] = [];
  const recoveries = ctx.active
    .map((h) => recoveryStats(ctx.data, h, ctx.ref).average)
    .filter((v): v is number => v != null);
  if (recoveries.length) {
    const avg = recoveries.reduce((a, b) => a + b, 0) / recoveries.length;
    facts.push(`Cuando se te corta un hábito, sueles retomarlo en **${dec1(avg)} días** de media: ya sabes volver.`);
  }
  const best = ctx.active
    .map((h) => ({ h, best: bestStreak(ctx.data, h, ctx.ref) }))
    .sort((a, b) => b.best - a.best)[0];
  if (best && best.best >= 3) facts.push(`Tu mejor racha en ${bold(best.h)} fue de ${best.best} días. Eso no se pierde.`);
  const reason = topFailReason(ctx);
  if (reason) facts.push(`Tu motivo de fallo más registrado es «${reason.label}». Pensemos el plan para ese caso.`);
  if (facts.length) out.push(bullets(facts));
  out.push(pickPhrase('recaida.cierre', g));
  return out;
}

function replyMotivacion(ctx: Ctx): Out {
  const g = ctx.gender;
  const out: Out = [pickPhrase('motivacion.apertura', g)];
  const facts: string[] = [];
  const eco = economyOf(ctx);
  if (eco.xpTotal > 0) facts.push(`Ya acumulas **${eco.xpTotal} XP** (nivel ${levelFromXp(eco.xpTotal).level}). Todo eso lo construiste tú.`);
  const s = streakOf(ctx);
  if (s.streak > 0) facts.push(`Tu racha va en ${plural(s.streak, 'día', 'días')}.`);
  const top = rankedConsistency(ctx)[0];
  if (top && top.value >= 0.5) facts.push(`Tu hábito más sólido es ${bold(top.habit)}, con ${pct(top.value)} de constancia en 30 días.`);
  if (facts.length) out.push(bullets(facts));
  out.push(pickPhrase('motivacion.cierre', g));
  return out;
}

function replyMinimo(ctx: Ctx): Out {
  const g = ctx.gender;
  const ratio = ctx.data.settings.minimumRatio;
  const out: Out = [pickPhrase('minimo.apertura', g)];
  const list = (ctx.pending.length ? ctx.pending : ctx.active).slice(0, 5);
  if (list.length) out.push(bullets(list.map((h) => `${bold(h)}: mínimo ${minimumText(h, ratio)} (meta ${targetText(h)})`)));
  out.push(`La versión mínima mantiene tu racha y suma el ${pct(ratio)} del valor del hábito.`);
  const reason = topFailReason(ctx);
  if (reason) out.push(`Tu obstáculo más frecuente es «${reason.label}»: justo ahí el mínimo te salva.`);
  out.push(pickPhrase('minimo.cierre', g));
  return out;
}

function replyProcrastinacion(ctx: Ctx): Out {
  const g = ctx.gender;
  const out: Out = [pickPhrase('procrastinacion.apertura', g)];
  const target = ctx.pending[0] ?? rankedConsistency(ctx).at(-1)?.habit;
  if (target) out.push(`Empieza por ${bold(target)} solo con su mínimo: ${minimumText(target, ctx.data.settings.minimumRatio)}.`);
  out.push(pickPhrase('procrastinacion.cierre', g));
  return out;
}

function replyEstres(ctx: Ctx): Out {
  const g = ctx.gender;
  const out: Out = [pickPhrase('estres.apertura', g)];
  const facts: string[] = [];
  if (ctx.today.length) facts.push(`Hoy tienes ${plural(ctx.today.length, 'hábito programado', 'hábitos programados')} y te ${ctx.pending.length === 1 ? 'queda' : 'quedan'} ${ctx.pending.length}.`);
  const key = [...ctx.pending].sort((a, b) => b.priority - a.priority)[0];
  if (key) facts.push(`Si solo haces uno, que sea ${bold(key)}, en su versión mínima (${minimumText(key, ctx.data.settings.minimumRatio)}).`);
  if (ctx.active.length >= 6) facts.push(`Tienes ${ctx.active.length} hábitos activos. Si sientes mucha carga, pausar uno o dos es válido.`);
  if (facts.length) out.push(bullets(facts));
  out.push(pickPhrase('estres.cierre', g));
  return out;
}

function replyCansancio(ctx: Ctx): Out {
  const g = ctx.gender;
  const ratio = ctx.data.settings.minimumRatio;
  const out: Out = [pickPhrase('cansancio.apertura', g)];
  const key = [...ctx.pending].sort((a, b) => b.priority - a.priority).slice(0, 2);
  if (key.length) out.push(`Hoy bastaría con: ${key.map((h) => `${bold(h)} (${minimumText(h, ratio)})`).join(' y ')}.`);
  const reason = topFailReason(ctx);
  if (reason) out.push(`Tu motivo de fallo más registrado es «${reason.label}». Tenerlo en cuenta te ayuda a planear mejor.`);
  out.push(pickPhrase('cansancio.cierre', g));
  return out;
}

/** Constancia, recuperación y mínimo de los hábitos de un tema (ejercicio, estudio, sueño) */
function topicFacts(ctx: Ctx, habits: Habit[]): string[] {
  const ratio = ctx.data.settings.minimumRatio;
  return habits.slice(0, 3).map((h) => {
    const c = consistency(ctx.data, h, 30, ctx.ref);
    const rec = recoveryStats(ctx.data, h, ctx.ref).average;
    return `${bold(h)}: ${c != null ? `${pct(c)} de constancia en 30 días` : 'aún sin datos suficientes'}${
      rec != null ? `; si lo cortas, lo retomas en ${dec1(rec)} días de media` : ''
    }; mínimo ${minimumText(h, ratio)}.`;
  });
}

function replyTema(ctx: Ctx, topic: 'sueno' | 'ejercicio' | 'estudio'): Out {
  const g = ctx.gender;
  const re = topic === 'sueno' ? SLEEP_RE : topic === 'ejercicio' ? EXERCISE_RE : STUDY_RE;
  const habits = habitsMatching(ctx, re);
  const out: Out = [pickPhrase(`${topic}.apertura`, g)];
  if (habits.length) out.push(bullets(topicFacts(ctx, habits)));
  if (topic === 'estudio' && habits.length) {
    const from = addDaysKey(ctx.ref, -6);
    const ids = new Set(habits.map((h) => h.id));
    const min = ctx.data.sessions.filter((s) => ids.has(s.habitId) && s.date >= from && s.date <= ctx.ref).reduce((a, s) => a + s.durationSec / 60, 0);
    if (min >= 1) out.push(`En los últimos 7 días sumaste **${Math.round(min)} min** de sesiones en estos hábitos.`);
  }
  out.push(pickPhrase(`${topic}.consejo`, g));
  if (!habits.length) out.push(phraseText(topic === 'sueno' ? 'sueno.cierre.1' : `${topic}.sin_habito.1`, g));
  return out;
}

function replyComparar(ctx: Ctx): Out {
  const g = ctx.gender;
  const list = comparedHabits(ctx)
    .map((h) => ({ h, c: consistency(ctx.data, h, 30, ctx.ref) }))
    .sort((a, b) => (b.c ?? -1) - (a.c ?? -1));
  const out: Out = [pickPhrase('dificil.apertura', g)];
  out.push(bullets(list.map(({ h, c }) => `${bold(h)}: ${c != null ? `${pct(c)} de constancia en 30 días` : 'aún sin datos'}`)));
  const weakest = list.at(-1);
  if (weakest && weakest.c != null) {
    const reason = topFailReason(ctx, weakest.h.id);
    out.push(`El que más se resiste es ${bold(weakest.h)}${reason ? `, sobre todo por «${reason.label}»` : ''}. Su horario es: ${TIME_LABEL[weakest.h.preferredTime].toLowerCase()}.`);
  }
  out.push(pickPhrase('dificil.cierre', g));
  return out;
}

function replyDificil(ctx: Ctx): Out {
  const g = ctx.gender;
  const ranked = rankedConsistency(ctx);
  const target = mentionedHabits(ctx)[0] ?? ranked.at(-1)?.habit;
  if (!target) return [phraseText('progreso.sin_datos.1', g)];
  const out: Out = [pickPhrase('dificil.apertura', g)];
  const c = consistency(ctx.data, target, 30, ctx.ref);
  const reason = topFailReason(ctx, target.id);
  const facts = [
    `${bold(target)}: ${c != null ? `${pct(c)} de constancia en 30 días` : 'aún sin datos suficientes'}.`,
    `Meta ${targetText(target)}, mínimo ${minimumText(target, ctx.data.settings.minimumRatio)}, horario: ${TIME_LABEL[target.preferredTime].toLowerCase()}.`,
  ];
  if (reason) facts.push(`Cuando falla, el motivo más registrado es «${reason.label}» (${plural(reason.count, 'vez', 'veces')}).`);
  out.push(bullets(facts));
  out.push(pickPhrase('dificil.cierre', g));
  return out;
}

/** Franja del día en la que más hábitos se completan (por la hora de las sesiones o de los registros) */
function bestTimeOfDay(ctx: Ctx): { label: string; share: number; total: number } | null {
  const from = addDaysKey(ctx.ref, -60);
  const hours: number[] = [];
  for (const s of ctx.data.sessions) if (s.date >= from && s.status !== 'abandoned') hours.push(new Date(s.startedAt).getHours());
  if (hours.length < 5) {
    for (const l of Object.values(ctx.data.logs)) {
      // Solo registros del mismo día (los de días atrasados no dicen a qué hora se hizo el hábito)
      if (l.date >= from && isDoneLog(l) && l.loggedAt.slice(0, 10) === l.date) hours.push(new Date(l.loggedAt).getHours());
    }
  }
  if (hours.length < 5) return null;
  const bands = [
    { label: 'temprano en la mañana (5 a 9)', test: (h: number) => h >= 5 && h < 9 },
    { label: 'la mañana (9 a 12)', test: (h: number) => h >= 9 && h < 12 },
    { label: 'el mediodía (12 a 15)', test: (h: number) => h >= 12 && h < 15 },
    { label: 'la tarde (15 a 19)', test: (h: number) => h >= 15 && h < 19 },
    { label: 'la noche (19 a 23)', test: (h: number) => h >= 19 && h < 23 },
    { label: 'la madrugada (23 a 5)', test: (h: number) => h >= 23 || h < 5 },
  ];
  const best = bands.map((b) => ({ label: b.label, count: hours.filter(b.test).length })).sort((a, b) => b.count - a.count)[0];
  return { label: best.label, share: best.count / hours.length, total: hours.length };
}

/** Día de la semana con más hábitos completados en las últimas 8 semanas */
function bestWeekday(ctx: Ctx): string | null {
  const from = addDaysKey(ctx.ref, -56);
  const counts = new Array(7).fill(0);
  let total = 0;
  for (const l of Object.values(ctx.data.logs)) {
    if (l.date >= from && l.date <= ctx.ref && isDoneLog(l)) {
      counts[weekdayIndex(l.date)]++;
      total++;
    }
  }
  if (total < 7) return null;
  return DAY_LONG[counts.indexOf(Math.max(...counts))];
}

function replyHallazgo(ctx: Ctx): Out {
  const g = ctx.gender;
  const facts: string[] = [];
  const time = bestTimeOfDay(ctx);
  if (time) facts.push(`Tu mejor momento es ${time.label}: ahí completas el ${pct(time.share)} de tus hábitos.`);
  const day = bestWeekday(ctx);
  if (day) facts.push(`El día en que más cumples es el ${day}.`);
  const ranked = rankedConsistency(ctx);
  if (ranked.length >= 2) {
    facts.push(`Tu hábito más sólido es ${bold(ranked[0].habit)} (${pct(ranked[0].value)}) y el que más cuesta, ${bold(ranked.at(-1)!.habit)} (${pct(ranked.at(-1)!.value)}).`);
  }
  if (!facts.length) return [phraseText('progreso.sin_datos.1', g)];
  return [pickPhrase('hallazgo.apertura', g), bullets(facts), pickPhrase('hallazgo.cierre', g)];
}

function replyProgreso(ctx: Ctx): Out {
  const g = ctx.gender;
  const week = weekSummary(ctx.data, startOfWeekKey(ctx.ref), ctx.ref);
  const eco = economyOf(ctx);
  const s = streakOf(ctx);
  const ranked = rankedConsistency(ctx);
  if (!Object.keys(ctx.data.logs).length) return [phraseText('progreso.sin_datos.1', g)];
  const facts: string[] = [];
  if (week.scheduled) facts.push(`Esta semana: ${week.done} de ${week.scheduled} hábitos programados hechos${week.consistency != null ? ` (${pct(week.consistency)} de constancia)` : ''}.`);
  if (week.minutes >= 1) facts.push(`Minutos de enfoque esta semana: **${Math.round(week.minutes)}**.`);
  facts.push(`Racha: ${plural(s.streak, 'día', 'días')} · XP total: ${eco.xpTotal} (nivel ${levelFromXp(eco.xpTotal).level}) · Monedas: ${eco.balance}.`);
  if (ranked.length) facts.push(`Más sólido: ${bold(ranked[0].habit)} (${pct(ranked[0].value)}).`);
  if (ranked.length >= 2) facts.push(`Por reforzar: ${bold(ranked.at(-1)!.habit)} (${pct(ranked.at(-1)!.value)}).`);
  return [pickPhrase('progreso.apertura', g), bullets(facts), pickPhrase('progreso.cierre', g)];
}

function replyObjetivos(ctx: Ctx): Out {
  const g = ctx.gender;
  const goals = ctx.data.goals.filter((goal) => goal.status === 'active');
  if (!goals.length) return [phraseText('objetivos.sin_objetivos.1', g)];
  const prio = (p: number) => (p === 3 ? 'prioridad alta' : p === 2 ? 'prioridad media' : 'prioridad baja');
  const linked = (goalId: string) => ctx.active.filter((h) => h.goals.some((l) => l.goalId === goalId)).length;
  const out: Out = [pickPhrase('objetivos.apertura', g)];
  out.push(
    bullets(
      goals.map((goal) => {
        const n = linked(goal.id);
        return `**${goal.name}**: ${prio(goal.priority)}, ${plural(n, 'hábito conectado', 'hábitos conectados')}${goal.targetDate ? `, meta el ${shortDate(goal.targetDate)}` : ''}.`;
      }),
    ),
  );
  if (goals.some((goal) => linked(goal.id) === 0)) out.push('Hay objetivos sin hábitos conectados: sin acciones diarias, no avanzan solos.');
  out.push(pickPhrase('objetivos.cierre', g));
  return out;
}

function replyXp(ctx: Ctx): Out {
  const g = ctx.gender;
  const eco = economyOf(ctx);
  const lvl = levelFromXp(eco.xpTotal);
  return [
    pickPhrase('xp.apertura', g),
    bullets([
      `XP total: **${eco.xpTotal}** · nivel **${lvl.level}** (te faltan ${Math.max(0, Math.round(lvl.xpForNext - lvl.xpInLevel))} XP para el siguiente).`,
      `Monedas disponibles: **${eco.balance}** (ganaste ${eco.earned} y gastaste ${eco.spent}).`,
    ]),
    pickPhrase('xp.explica', g),
  ];
}

function replyPrimer(ctx: Ctx): Out {
  const g = ctx.gender;
  if (ctx.active.length >= MAX_ACTIVE_HABITS) return [phraseText('accion.limite.1', g)];
  return [
    pickPhrase('primer.apertura', g),
    bullets(['leer', 'agua', 'caminar', 'respirar'].map((k) => phraseText(`primer.idea.${k}`, g))),
    pickPhrase('primer.cierre', g),
  ];
}

/** Respuestas de «cómo se usa» la app: frases fijas y, si aplica, un dato real */
function replyApp(ctx: Ctx, intent: Intent): Out {
  const g = ctx.gender;
  const p = (id: string) => phraseText(id, g);
  switch (intent) {
    case 'app_tema':
      return [p('app.tema.1')];
    case 'app_voz':
      return [p('app.voz.1'), p('app.voz.2')];
    case 'app_ligas':
      return [p('app.ligas.1'), p('app.ligas.2')];
    case 'app_logros': {
      const s = streakOf(ctx);
      return [p('app.logros.1'), ...(s.streak > 0 ? [`Tu racha actual (${plural(s.streak, 'día', 'días')}) ya cuenta para los logros de constancia.`] : [])];
    }
    case 'app_comunidad':
      return [p('app.comunidad.1'), p('app.comunidad.2')];
    case 'app_perfil':
      return [p('app.perfil.1')];
    case 'app_tienda':
      return [p('app.tienda.1'), p('app.tienda.2'), `Ahora tienes **${economyOf(ctx).balance} monedas**.`];
    case 'app_temporizador': {
      const from = addDaysKey(ctx.ref, -6);
      const min = ctx.data.sessions.filter((s) => s.date >= from && s.date <= ctx.ref).reduce((a, s) => a + s.durationSec / 60, 0);
      return [p('app.temporizador.1'), p('app.temporizador.2'), ...(min >= 1 ? [`En los últimos 7 días llevas **${Math.round(min)} min** de sesiones.`] : [])];
    }
    case 'app_experimentos':
      return replyExperimento(ctx);
    case 'app_mapa':
      return [p('app.mapa.1'), ...(ctx.data.relations.length ? [`Ya tienes ${plural(ctx.data.relations.length, 'conexión', 'conexiones')} en tu mapa.`] : [])];
    case 'app_revision':
      return [p('app.revision.1')];
    case 'app_retos':
      return [p('app.retos.1')];
    case 'app_insights': {
      const reason = topFailReason(ctx);
      return [p('app.insights.1'), ...(reason ? [`Por ejemplo, ahí verás que tu obstáculo principal es «${reason.label}».`] : [])];
    }
    case 'app_calendario':
      return [p('app.calendario.1')];
    case 'app_habitos':
      return [p('app.habitos.1'), p('app.habitos.2'), `Ahora tienes ${ctx.active.length} de ${MAX_ACTIVE_HABITS} hábitos activos.`];
    case 'app_registrar':
      return [p('app.registrar.1')];
    case 'app_objetivos':
      return [p('app.objetivos.1')];
    default:
      return [p('app.general.1')];
  }
}

/** Explica el laboratorio y, si hay un hábito flojo sin experimento en marcha, propone uno de horario */
function replyExperimento(ctx: Ctx): Out {
  const g = ctx.gender;
  const out: Out = [phraseText('app.experimentos.1', g)];
  const weakest = rankedConsistency(ctx).filter((x) => x.value < 0.7).at(-1)?.habit;
  const busy = weakest && ctx.data.experiments.some((e) => e.status === 'running' && e.habitId === weakest.id);
  if (!weakest || busy) return out;
  const current = weakest.preferredTime === 'any' ? 'cuando puedo' : `por la ${TIME_LABEL[weakest.preferredTime].toLowerCase()}`;
  const alt = weakest.preferredTime === 'morning' ? 'por la noche' : 'por la mañana';
  out.push(`Te propongo uno para ${bold(weakest)}: 7 días ${current} y 7 días ${alt}, y comparamos.`);
  out.push(pickPhrase('accion.propuesta', g));
  out.push(
    actionBlock('create_experiment', {
      name: `Horario de ${weakest.name}`,
      habitName: weakest.name,
      hypothesis: `Hacer «${weakest.name}» ${alt} mejora mi constancia frente a hacerlo ${current}`,
      type: 'schedule',
      durationDays: 14,
      variants: [
        { id: 'v1', label: current.charAt(0).toUpperCase() + current.slice(1), startDay: 1, endDay: 7 },
        { id: 'v2', label: alt.charAt(0).toUpperCase() + alt.slice(1), startDay: 8, endDay: 14 },
      ],
    }),
  );
  return out;
}

function replyGeneral(ctx: Ctx): Out {
  const g = ctx.gender;
  if (!ctx.active.length) return replyPrimer(ctx);
  const facts: string[] = [];
  const avg = averageConsistency(ctx);
  facts.push(`Tienes ${plural(ctx.active.length, 'hábito activo', 'hábitos activos')}${avg != null ? `, con ${pct(avg)} de constancia media en 30 días` : ''}.`);
  if (ctx.today.length) facts.push(`Hoy llevas ${ctx.done.length} de ${ctx.today.length}.`);
  const s = streakOf(ctx);
  if (s.streak > 0) facts.push(`Racha: ${plural(s.streak, 'día', 'días')}.`);
  const reason = topFailReason(ctx);
  if (reason) facts.push(`Tu obstáculo más frecuente: «${reason.label}».`);
  return [pickPhrase('general.apertura', g), bullets(facts), pickPhrase('general.cierre', g)];
}

/* ---------------- Crear un hábito desde el chat ---------------- */

const NUMBER_WORDS: Record<string, number> = {
  uno: 1, dos: 2, tres: 3, cinco: 5, diez: 10, quince: 15, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, noventa: 90,
};

const ICONS: [RegExp, string][] = [
  [/leer|lectura|libro/, '📖'], [/agua|hidrat/, '💧'], [/caminar|pasos/, '🚶'], [/correr|trotar/, '🏃'],
  [/ejercicio|gym|gimnasio|pesas|entren|flexiones/, '💪'], [/yoga|estir/, '🧘'], [/medit|respir/, '🧘'],
  [/estudi|repas|examen|curso/, '📚'], [/dormir|acostar|sueno/, '😴'], [/escrib|diario/, '✍️'],
  [/program|codigo/, '💻'], [/idioma|ingles|frances|aleman/, '🗣️'], [/fruta|verdura|comer|cocinar/, '🥗'],
  [/ordenar|limpi/, '🧹'], [/musica|guitarra|piano/, '🎸'],
];

/**
 * «Créame un hábito de leer 20 minutos por la mañana» → propuesta de hábito (la persona la acepta en la tarjeta).
 * Devuelve null si el mensaje no pide crear un hábito con nombre.
 */
function habitRequest(prompt: string): Record<string, unknown> | null {
  const m = prompt.match(
    /\b(?:cr[eé]a(?:me|r)?|a[ñn]ad[ei](?:me|r)?|agrega(?:me|r)?|haz(?:me)?|pon(?:me)?|arma(?:me)?)\s+(?:(?:un|una|el|mi|nuevo|nueva)\s+)*h[aá]bito\b\s*(?:de|para|llamado|que se llame|:)?\s*(.*)$/i,
  );
  if (!m) return null;
  let rest = m[1].replace(/[.!?¿¡]+$/g, '').trim();
  const n = nrm(rest);

  let minutes: number | undefined;
  const num = n.match(/(\d{1,3})\s*(?:min(?:utos?)?|m)\b/);
  const word = n.match(/\b(uno|dos|tres|cinco|diez|quince|veinte|veinticinco|treinta|cuarenta|cincuenta|sesenta|noventa)\s+min(?:utos?)?\b/);
  if (num) minutes = Number(num[1]);
  else if (word) minutes = NUMBER_WORDS[word[1]];
  else if (/\bmedia hora\b/.test(n)) minutes = 30;
  else if (/\buna hora\b/.test(n)) minutes = 60;

  const preferredTime: TimeOfDay = /\b(manana|mananas|al despertar|temprano)\b/.test(n)
    ? 'morning'
    : /\b(tarde|tardes)\b/.test(n)
    ? 'afternoon'
    : /\b(noche|noches|antes de dormir)\b/.test(n)
    ? 'evening'
    : 'any';

  // El nombre: lo que queda sin la duración, el momento del día ni la frecuencia
  rest = rest
    .replace(/\b(?:durante|por|de)?\s*(?:\d{1,3}|uno|dos|tres|cinco|diez|quince|veinte|veinticinco|treinta|cuarenta|cincuenta|sesenta|noventa)\s*(?:min(?:utos?)?|m)\b/gi, ' ')
    .replace(/\b(?:durante\s+)?(?:media|una)\s+hora\b/gi, ' ')
    .replace(/\b(?:cada|por la|en la|en las|todas las|todos los|al)\s+(?:mañanas?|mananas?|tardes?|noches?|d[ií]as?|despertar)\b/gi, ' ')
    .replace(/\b(?:antes de dormir|diario|diariamente|a diario)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:de|para|a)\s+/i, '')
    .trim()
    .slice(0, 40)
    .trim();
  if (rest.length < 2) return null;
  const name = rest.charAt(0).toUpperCase() + rest.slice(1);
  const icon = ICONS.find(([re]) => re.test(nrm(name)))?.[1] ?? '🎯';

  return {
    name,
    icon,
    preferredTime,
    priority: 2,
    ...(minutes ? { targetMinutes: Math.min(600, minutes), minimumMinutes: Math.max(1, Math.round(minutes * 0.25)) } : {}),
  };
}

function replyCrearHabito(ctx: Ctx, habit: Record<string, unknown>): Out {
  const g = ctx.gender;
  if (ctx.active.length >= MAX_ACTIVE_HABITS) return [phraseText('accion.limite.1', g)];
  const details = [
    habit.targetMinutes ? `${habit.targetMinutes} min (mínimo ${habit.minimumMinutes} min)` : 'de acción: hecho o no hecho',
    TIME_LABEL[habit.preferredTime as TimeOfDay].toLowerCase(),
  ];
  return [
    pickPhrase('accion.propuesta', g),
    `Hábito: **${habit.icon} ${habit.name}**, ${details.join(', ')}. Luego puedes ajustarlo en Mi semana.`,
    actionBlock('create_habit', habit),
  ];
}

/* ---------------- Entrada ---------------- */

/** Cada cuántas respuestas locales se recuerda que con clave de IA el coach responde mejor */
const NOTE_EVERY = 5;
let localReplies = 0;

/**
 * Respuesta del coach sin IA. `withNote`: añade de vez en cuando el aviso de que responde el motor local
 * (no cuando la IA falló: esa respuesta ya lleva su propia nota).
 */
export function localCoachReply(data: AppData, prompt: string, { withNote = true }: { withNote?: boolean } = {}): string {
  const ref = todayKey();
  const ctx = buildCtx(data, prompt, ref);
  // La respuesta a una propuesta («Acepté tu propuesta de crear hábito…») no es un pedido de hábito nuevo
  const habit = CHOICE_RE.test(ctx.n) ? null : habitRequest(prompt);
  const intent = habit ? null : detectIntent(ctx);

  let out: Out;
  if (habit) out = replyCrearHabito(ctx, habit);
  else {
    switch (intent) {
      case 'accion': out = replyAccion(ctx); break;
      case 'saludo': out = replySaludo(ctx); break;
      case 'despedida': out = replyDespedida(ctx); break;
      case 'gracias': out = [pickPhrase('gracias.respuesta', ctx.gender)]; break;
      case 'ayuda': out = replyAyuda(ctx); break;
      case 'recaida': out = replyRecaida(ctx); break;
      case 'estres': out = replyEstres(ctx); break;
      case 'cansancio': out = replyCansancio(ctx); break;
      case 'motivacion': out = replyMotivacion(ctx); break;
      case 'procrastinacion': out = replyProcrastinacion(ctx); break;
      case 'xp': out = replyXp(ctx); break;
      case 'comparar': out = replyComparar(ctx); break;
      case 'sueno':
      case 'ejercicio':
      case 'estudio': out = replyTema(ctx, intent); break;
      case 'minimo': out = replyMinimo(ctx); break;
      case 'racha': out = replyRacha(ctx); break;
      case 'ahora': out = replyAhora(ctx); break;
      case 'organizar': out = replyOrganizar(ctx); break;
      case 'primer': out = replyPrimer(ctx); break;
      case 'hallazgo': out = replyHallazgo(ctx); break;
      case 'dificil': out = replyDificil(ctx); break;
      case 'progreso': out = replyProgreso(ctx); break;
      case 'objetivos': out = replyObjetivos(ctx); break;
      case 'general':
      case null: out = replyGeneral(ctx); break;
      default: out = replyApp(ctx, intent);
    }
  }

  // Charla corta (saludos, gracias, despedidas, acciones) sin la nota: sería más larga que la respuesta
  const chit = intent === 'saludo' || intent === 'gracias' || intent === 'despedida' || intent === 'accion';
  if (withNote && !chit && localReplies++ % NOTE_EVERY === 0) out.push(pickPhrase('local.nota', ctx.gender));
  return out.filter(Boolean).join('\n\n');
}
