import { create } from 'zustand';
import type { Ban, CatalogItem, ProfileRow } from './types';

/**
 * ESTADO DE LA CAPA PÚBLICA (no se guarda en los datos cifrados: se pide al servidor al arrancar)
 * - `available`: el servidor tiene la migración 0002 aplicada. Si no, todo lo social se oculta sin romper la app.
 * - `isAdmin`: lo dice el servidor (`is_admin()`); se recuerda en el dispositivo para la interfaz sin conexión.
 */
export interface SocialState {
  phase: 'off' | 'loading' | 'ready' | 'error';
  available: boolean;
  isAdmin: boolean;
  ban: Ban | null;
  profile: ProfileRow | null;
  baselineAt: string | null;
  /** Saldo verificado por el servidor (el que cuenta para la tienda de cosméticos) */
  serverBalance: number | null;
  unread: number;
  catalog: CatalogItem[];
  /** Ids de los artículos que tiene la persona */
  inventory: string[];
  /** Última publicación correcta (ms) */
  lastPublishedAt: number | null;
  error?: string;
  set: (patch: Partial<Omit<SocialState, 'set'>>) => void;
}

export const initialSocial: Omit<SocialState, 'set'> = {
  phase: 'off',
  available: true,
  isAdmin: false,
  ban: null,
  profile: null,
  baselineAt: null,
  serverBalance: null,
  unread: 0,
  catalog: [],
  inventory: [],
  lastPublishedAt: null,
};

export const useSocial = create<SocialState>()((set) => ({
  ...initialSocial,
  set: (patch) => set(patch),
}));

/** Artículo del catálogo por id (para dibujar lo equipado) */
export const catalogItem = (id: string | null | undefined) => (id ? useSocial.getState().catalog.find((c) => c.id === id) : undefined);

export const useCatalogItem = (id: string | null | undefined) => useSocial((s) => (id ? s.catalog.find((c) => c.id === id) : undefined));
