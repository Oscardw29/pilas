import { useEffect } from 'react';
import { create } from 'zustand';
import { useSession } from '@/store/useSession';
import { getUserAchievements, socialAvailable } from './api';
import { onSocialNotice } from './runtime';
import { useSocial } from './useSocial';

/**
 * MEDALLAS POR VER
 * Cada logro conseguido enseña su medalla (AchievementUnlockOverlay) UNA sola vez: al tocar su tarjeta en
 * Logros → Conseguidos. Hasta entonces la tarjeta late para invitar a tocarla y un «!» rojo marca el camino:
 * «Más» (barra inferior) → «Logros» → «Conseguidos».
 * Lo ya visto se recuerda en este dispositivo, por cuenta. La primera vez (sin nada guardado) los logros que ya se
 * tenían cuentan como vistos: el aviso es para los que lleguen a partir de ahora.
 */

const keyFor = (uid: string | null) => `pilas:ach-seen:${uid ?? 'local'}`;

function readSeen(uid: string | null): Set<string> | null {
  try {
    const raw = localStorage.getItem(keyFor(uid));
    if (raw == null) return null;
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return null;
  }
}

function writeSeen(uid: string | null, seen: Set<string>) {
  try {
    localStorage.setItem(keyFor(uid), JSON.stringify([...seen]));
  } catch {
    /* sin almacenamiento: se vuelve a avisar en la próxima sesión */
  }
}

interface SeenState {
  uid: string | null;
  /** null: aún no se sabe qué logros tiene la cuenta */
  earned: string[] | null;
  seen: Set<string>;
  /** Fija los logros conseguidos (los del servidor y, en demostración, los de la vista previa) */
  setEarned: (ids: string[]) => void;
  markSeen: (id: string) => void;
}

export const useAchievementSeen = create<SeenState>()((set, get) => ({
  uid: null,
  earned: null,
  seen: new Set(),
  setEarned: (ids) => {
    const uid = useSession.getState().user?.id ?? null;
    let seen = readSeen(uid);
    if (seen === null) {
      // Primera vez en este dispositivo: lo que ya tenía cuenta como visto
      seen = new Set(ids);
      writeSeen(uid, seen);
    }
    set({ uid, earned: [...new Set(ids)], seen });
  },
  markSeen: (id) => {
    const { uid, seen } = get();
    if (seen.has(id)) return;
    const next = new Set(seen);
    next.add(id);
    writeSeen(uid, next);
    set({ seen: next });
  },
}));

/** Logros conseguidos cuya medalla aún no se vio */
export const useUnseenAchievements = (): string[] =>
  useAchievementSeen((s) => (s.earned ?? []).filter((id) => !s.seen.has(id)).join('|'))
    .split('|')
    .filter(Boolean);

/** ¿Hay alguna medalla por ver? (para el «!» de la navegación) */
export const useHasUnseenAchievements = () => useAchievementSeen((s) => (s.earned ?? []).some((id) => !s.seen.has(id)));

/**
 * Mantiene al día los logros de la cuenta para el «!» de la navegación: al entrar y cada vez que el servidor
 * avisa de un logro nuevo. Lo monta Shell.
 */
export function useAchievementSeenSync() {
  const available = useSocial((s) => s.available);
  const uid = useSession((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!available || !uid || !socialAvailable()) return;
    let alive = true;
    const load = () =>
      getUserAchievements(uid)
        .then((rows) => {
          if (!alive) return;
          // No se pisan los de la vista previa de demostración que haya puesto la página de Logros
          const prev = useAchievementSeen.getState();
          const extra = prev.uid === uid ? (prev.earned ?? []) : [];
          useAchievementSeen.getState().setEarned([...rows.map((r) => r.achievement_id), ...extra]);
        })
        .catch(() => undefined);
    void load();
    const off = onSocialNotice((n) => {
      if (n.kind === 'achievement') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [available, uid]);
}
