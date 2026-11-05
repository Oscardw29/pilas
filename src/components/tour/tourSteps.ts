/**
 * PASOS DEL TUTORIAL GUIADO
 * Cada paso lleva a una sección (`route`) y resalta lo primero visible de `targets` (en escritorio la barra lateral, en
 * el teléfono la barra inferior o el botón «Más»). Sin objetivo visible, la tarjeta del coach sale en el centro.
 * El texto sale del catálogo de frases (src/data/coachPhrases.json, ids «tutorial.*») para que tenga voz grabada.
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
  /** Frase del catálogo (tutorial.*) */
  phrase: string;
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
  { id: 'intro', title: 'Un recorrido rápido', phrase: 'tutorial.intro' },
  { id: 'home', title: 'Inicio', phrase: 'tutorial.inicio', route: '/', targets: ['[data-tour="home-hero"]', ...nav('/')] },
  { id: 'goals', title: 'Objetivos', phrase: 'tutorial.objetivos', route: '/objetivos', targets: nav('/objetivos') },
  { id: 'habits', title: 'Hábitos', phrase: 'tutorial.habitos', route: '/semana', targets: nav('/semana') },
  {
    id: 'create',
    title: 'Tu primer hábito',
    phrase: 'tutorial.crear',
    route: '/semana',
    targets: ['[data-tour="new-habit"]'],
    interactive: true,
    createHabit: true,
  },
  {
    id: 'created',
    title: '¡Primer hábito listo!',
    phrase: 'tutorial.creado',
    route: '/semana',
    targets: ['.week-matrix tbody tr:first-child', '.habit-card-list > :first-child'],
    when: (c) => c.created,
  },
  { id: 'timer', title: 'Temporizador', phrase: 'tutorial.temporizador', route: '/temporizador', targets: nav('/temporizador') },
  { id: 'coach', title: 'Siempre a mano', phrase: 'tutorial.coach', route: '/', targets: ['.coach-fab', ...nav('/coach')] },
  { id: 'tracking', title: 'Seguimiento', phrase: 'tutorial.seguimiento', route: '/calendario', targets: group('Seguimiento') },
  { id: 'analysis', title: 'Análisis', phrase: 'tutorial.analisis', route: '/insights', targets: group('Análisis') },
  { id: 'motivation', title: 'Motivación', phrase: 'tutorial.motivacion', route: '/recompensas', targets: group('Motivación') },
  {
    id: 'community',
    title: 'Comunidad',
    phrase: 'tutorial.comunidad',
    route: '/clasificaciones',
    targets: group('Comunidad'),
    when: (c) => c.social,
  },
  {
    id: 'profile',
    title: 'Tu perfil y Ajustes',
    phrase: 'tutorial.perfil',
    route: '/',
    targets: ['.sidebar .profile-block', '.mobile-topbar .profile-avatar-wrap'],
  },
  { id: 'end', title: '¡A por ello!', phrase: 'tutorial.final', route: '/' },
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
