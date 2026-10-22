import { create } from 'zustand';

/**
 * ESTADO DE LA SESIÓN Y LA SINCRONIZACIÓN (no se guarda: se reconstruye al arrancar)
 */

export type SessionStatus =
  /** Arrancando: leyendo la sesión guardada y la base local */
  | 'loading'
  /** Falta configurar Supabase en esta compilación */
  | 'unconfigured'
  /** Sin sesión: pantalla de inicio de sesión / registro */
  | 'signedOut'
  /** La cuenta tiene datos y este navegador también (versión anterior sin cuenta): hay que elegir */
  | 'legacyChoice'
  /** Sesión y datos listos: se muestra la app */
  | 'ready';

export type SyncStatus = 'idle' | 'syncing' | 'pending' | 'offline' | 'error';

export interface SessionUser {
  id: string;
  email: string;
}

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** La cuenta no tenía datos al entrar: se muestra la bienvenida */
  firstRun: boolean;
  sync: SyncStatus;
  syncError?: string;
  /** ms epoch de la última sincronización completa */
  lastSyncedAt?: number;
  /** Aviso para la pantalla de acceso (p. ej. la sesión se cerró desde el servidor) */
  notice?: string;
  /** En la elección de datos antiguos: ¿la cuenta ya tenía datos? */
  legacyAccountHasData?: boolean;
  set: (patch: Partial<Omit<SessionState, 'set'>>) => void;
}

export const useSession = create<SessionState>()((set) => ({
  status: 'loading',
  user: null,
  firstRun: false,
  sync: 'idle',
  set: (patch) => set(patch),
}));
