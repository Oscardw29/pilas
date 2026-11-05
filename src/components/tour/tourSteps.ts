/**
 * PASOS DEL TUTORIAL GUIADO
 * Cada paso lleva a una sección (`route`) y resalta lo primero visible de `targets` (en escritorio la barra lateral, en
 * el teléfono la barra inferior o el botón «Más»). Sin objetivo visible, la tarjeta del coach sale en el centro.
 * Sin voz: el coach solo muestra el texto.
 */

export interface TourContext {
  /** El servidor tiene la capa pública (si no, no hay sección Comunidad) */
  social: boolean;
  /** Se creó un hábito durante el tutorial */
  created: boolean;
}

export interface TourStep {
  id: string;
  title: string;
  /** Lo que dice el coach (la presentación lleva su nombre) */
  text: string | ((coachName: string) => string);
  route?: string;
  /** Selectores en orden de preferencia: se resalta el primero que esté visible */
  targets?: string[];
  /** El usuario tiene que usar lo resaltado (se deja tocar) */
  interactive?: boolean;
  /** Paso de crear el primer hábito: avanza solo cuando se guarda un hábito */
  createHabit?: boolean;
  when?: (ctx: TourContext) => boolean;
}

const nav = (to: string) => [`.sidebar [data-tour="nav:${to}"]`, `.bottom-nav [data-tour="nav:${to}"]`, '.bottom-nav [data-tour="nav-more"]'];
const group = (label: string) => [`.sidebar [data-tour="group:${label}"]`, '.bottom-nav [data-tour="nav-more"]'];

export const TOUR_STEPS: TourStep[] = [
  { id: 'intro', title: 'Un recorrido rápido', text: (name) => `¡Hola! Soy ${name} y te voy a mostrar la app en un minuto. Te llevo por cada sección y de paso creamos tu primer hábito.` },
  { id: 'home', title: 'Inicio', text: 'Esto es Inicio. Cada día verás aquí lo que te toca, tu racha y los puntos que llevas.', route: '/', targets: ['[data-tour="home-hero"]', ...nav('/')] },
  { id: 'goals', title: 'Objetivos', text: 'En Objetivos defines para qué haces tus hábitos. Cada hábito suma a un objetivo y así ves cuánto avanzas.', route: '/objetivos', targets: nav('/objetivos') },
  { id: 'habits', title: 'Hábitos', text: 'En Hábitos está tu semana, día por día. Marcas cada hábito como hecho, en su versión mínima o como día libre.', route: '/semana', targets: nav('/semana') },
  {
    id: 'create',
    title: 'Tu primer hábito',
    text: 'Vamos a crear tu primer hábito. Toca Nuevo hábito y elige algo pequeño, que puedas cumplir incluso en un mal día.',
    route: '/semana',
    targets: ['[data-tour="new-habit"]'],
    interactive: true,
    createHabit: true,
  },
  {
    id: 'created',
    title: '¡Primer hábito listo!',
    text: '¡Muy bien, ya tienes tu primer hábito! Márcalo aquí cada día. Hacer solo la versión mínima también cuenta para tu racha.',
    route: '/semana',
    targets: ['.week-matrix tbody tr:first-child', '.habit-card-list > :first-child'],
    when: (c) => c.created,
  },
  { id: 'timer', title: 'Temporizador', text: 'Con el Temporizador mides tus sesiones de enfoque, y ese tiempo se suma a tus hábitos.', route: '/temporizador', targets: nav('/temporizador') },
  { id: 'coach', title: 'Siempre a mano', text: 'Y aquí me encuentras a mí, en cualquier página. Pregúntame lo que quieras: reviso tus datos, te propongo cambios y también puedes enviarme fotos o archivos.', route: '/', targets: ['.coach-fab', ...nav('/coach')] },
  { id: 'tracking', title: 'Seguimiento', text: 'En Seguimiento están el Calendario, con todo tu historial, y la Revisión semanal, para ajustar lo que no funcionó.', route: '/calendario', targets: group('Seguimiento') },
  { id: 'analysis', title: 'Análisis', text: 'En Análisis te muestro patrones: Insights con decisiones sugeridas, el Mapa de cómo se conectan tus hábitos y Experimentos para probar qué te funciona mejor.', route: '/insights', targets: group('Análisis') },
  { id: 'motivation', title: 'Motivación', text: 'En Motivación tienes Retos de 30 días y Recompensas, donde cambias tus monedas por premios que eliges tú.', route: '/recompensas', targets: group('Motivación') },
  {
    id: 'community',
    title: 'Comunidad',
    text: 'En Comunidad compites en ligas, ves tus logros y sigues a tus amigos. Solo se publican tus cifras, nunca tus notas.',
    route: '/clasificaciones',
    targets: group('Comunidad'),
    when: (c) => c.social,
  },
  {
    id: 'profile',
    title: 'Tu perfil y Ajustes',
    text: 'Desde tu foto entras a tu perfil y a Ajustes, donde configuras el tema, tus recordatorios y mucho más.',
    route: '/',
    targets: ['.sidebar .profile-block', '.mobile-topbar .profile-avatar-wrap'],
  },
  { id: 'end', title: '¡A por ello!', text: '¡Eso es todo! Ya conoces la app. Recuerda: lo importante es la constancia, no la perfección. ¡Vamos con todo!', route: '/' },
];

export const tourSteps = (ctx: TourContext) => TOUR_STEPS.filter((s) => !s.when || s.when(ctx));

/** Primer elemento visible de la lista (con tamaño y sin estar oculto) */
export function resolveTarget(selectors: readonly string[] | undefined): HTMLElement | null {
  if (!selectors) return null;
  for (const sel of selectors) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      return el;
    }
  }
  return null;
}
