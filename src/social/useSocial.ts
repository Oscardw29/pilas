import { create } from 'zustand';
import type { Ban, CatalogItem, ProfileRow } from './types';

/**
 * ESTADO DE LA CAPA PÚBLICA (no se guarda en los datos cifrados: se pide al servidor al arrancar)
 * - `available`: el servidor tiene la migración 0002 aplicada. Si no, todo lo social se oculta sin romper la app.
 * - `profile`: todo perfil es público; lo crea solo social/runtime.ts al entrar con los datos de la bienvenida.
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
  /**
   * Alias que la persona eligió (en la bienvenida o sin conexión) y que al crear el perfil ya estaba en uso: el perfil
   * se creó sin alias y se le avisa para que elija otro en Ajustes
   */
  aliasConflict: string | null;
  /** El perfil público se acaba de crear solo para alguien que ya usaba la app (se le explica qué es público) */
  profileAutoCreated: boolean;
  /**
   * Los datos cambiaron por completo pero el servidor no dejó reiniciar el progreso público (máximo 10 reinicios al día):
   * en esta sesión no se publica nada (se mezclarían los datos de antes con los nuevos). App.tsx lo avisa una vez
   */
  resetLimited: boolean;
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
  aliasConflict: null,
  profileAutoCreated: false,
  resetLimited: false,
};

export const useSocial = create<SocialState>()((set) => ({
  ...initialSocial,
  set: (patch) => set(patch),
}));

/** Artículo del catálogo por id (para dibujar lo equipado) */
export const catalogItem = (id: string | null | undefined) => (id ? useSocial.getState().catalog.find((c) => c.id === id) : undefined);

export const useCatalogItem = (id: string | null | undefined) => useSocial((s) => (id ? s.catalog.find((c) => c.id === id) : undefined));
