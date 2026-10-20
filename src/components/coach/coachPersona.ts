import { useStore } from '@/store/useStore';
import type { Settings, UserGender } from '@/types';

/** Género del personaje: «otro» o sin elegir → entrenador */
export type CoachGender = 'male' | 'female';

export interface CoachPersona {
  gender: CoachGender;
  /** Nombre visible del coach (sustituye a «Coach IA» en toda la app) */
  name: string;
  /** «entrenador» / «entrenadora» */
  role: string;
  /** «el» / «la» */
  article: string;
}

const PERSONAS: Record<CoachGender, CoachPersona> = {
  male: { gender: 'male', name: 'Pilo', role: 'entrenador', article: 'el' },
  female: { gender: 'female', name: 'Pila', role: 'entrenadora', article: 'la' },
};

export const personaFor = (gender?: UserGender): CoachPersona => (gender === 'female' ? PERSONAS.female : PERSONAS.male);

/** Fuera de React (prompts de IA, notificaciones): lee los ajustes indicados o los del store */
export const getCoachPersona = (settings?: Pick<Settings, 'userGender'>): CoachPersona =>
  personaFor((settings ?? useStore.getState().settings)?.userGender);

export const useCoachPersona = (): CoachPersona => personaFor(useStore((s) => s.settings.userGender));
