import { create } from 'zustand';

/**
 * ESTADO DEL TUTORIAL GUIADO
 * Se abre solo una vez, tras la bienvenida del primer uso (ajuste `tutorialPending`), o cuando el creador lo lanza desde
 * su panel (Ajustes de prueba › Tutorial de bienvenida).
 */
interface TourState {
  active: boolean;
  /** Lo lanzó el creador desde su panel (no es el primer uso) */
  manual: boolean;
  index: number;
  start: (manual?: boolean) => void;
  go: (index: number) => void;
  stop: () => void;
}

export const useTour = create<TourState>()((set) => ({
  active: false,
  manual: false,
  index: 0,
  start: (manual = false) => set({ active: true, manual, index: 0 }),
  go: (index) => set({ index }),
  stop: () => set({ active: false, manual: false, index: 0 }),
}));

/** Lanza el tutorial desde cualquier parte (panel del creador) */
export const startTour = () => useTour.getState().start(true);
