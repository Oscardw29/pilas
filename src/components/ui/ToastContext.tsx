import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { CheckCircle2, Gift, Info, AlertTriangle, AlertCircle, X } from 'lucide-react';
import { isCelebrating, onCelebrationChange } from '@/lib/celebrationQueue';

export type ToastType = 'success' | 'reward' | 'info' | 'error' | 'warning' | 'danger';

type ToastKind = 'success' | 'reward' | 'info' | 'error' | 'warning';

interface ToastItem {
  id: string;
  type: ToastKind;
  message: string;
  sub?: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, sub?: string) => void;
  showToast: (message: string, type?: ToastType, sub?: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  showToast: () => {},
});

/** Los errores y avisos se quedan más tiempo en pantalla para poder leerlos */
const DURATION_MS: Record<ToastKind, number> = { success: 3800, reward: 3800, info: 3800, warning: 6000, error: 6500 };
/** En el teléfono tapan más: duran algo menos (se pueden descartar deslizándolos) */
const MOBILE_DURATION_MS: Record<ToastKind, number> = { success: 2600, reward: 3200, info: 2800, warning: 4800, error: 5500 };
const durationFor = (kind: ToastKind) =>
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639.98px)').matches ? MOBILE_DURATION_MS[kind] : DURATION_MS[kind];
/** Separación entre los avisos que esperaban a que terminara una celebración */
const FLUSH_STAGGER_MS = 220;

/**
 * Avisos flotantes. Quedan por detrás de las celebraciones a pantalla completa (z-index del contenedor en
 * global.css) y, mientras hay una en pantalla (lib/celebrationQueue), los nuevos esperan a que termine
 * para no competir con ella: luego salen de uno en uno.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const waiting = useRef<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (item: ToastItem) => {
      // Máximo 5 mensajes a la vez
      setToasts((prev) => [...prev, item].slice(-5));
      timers.current.set(item.id, setTimeout(() => remove(item.id), durationFor(item.type)));
    },
    [remove]
  );

  const toast = useCallback(
    (message: string, type: ToastType = 'success', sub?: string) => {
      const id = Math.random().toString(36).slice(2, 9);
      const kind: ToastKind = type === 'danger' ? 'error' : type;
      const item: ToastItem = { id, type: kind, message, sub };
      // Con una celebración en pantalla, espera su turno (sin duplicar el mismo texto)
      if (isCelebrating()) {
        if (!waiting.current.some((w) => w.message === message && w.sub === sub)) {
          const next = [...waiting.current, item];
          // Como mucho 5 en espera: se descarta primero el aviso más antiguo que no sea un error
          if (next.length > 5) {
            const drop = next.findIndex((w) => w.type !== 'error');
            next.splice(drop === -1 ? 0 : drop, 1);
          }
          waiting.current = next;
        }
        return;
      }
      show(item);
    },
    [show]
  );

  // Al terminar las celebraciones salen los avisos que esperaban, escalonados
  useEffect(() => {
    const flushTimers: ReturnType<typeof setTimeout>[] = [];
    const off = onCelebrationChange((busy) => {
      if (busy) return;
      const list = waiting.current;
      waiting.current = [];
      list.forEach((item, i) => {
        flushTimers.push(
          setTimeout(() => {
            // Si entre tanto empezó otra celebración, vuelve a esperar
            if (isCelebrating()) waiting.current = [...waiting.current, item];
            else show(item);
          }, 200 + i * FLUSH_STAGGER_MS),
        );
      });
    });
    return () => {
      off();
      flushTimers.forEach(clearTimeout);
    };
  }, [show]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  // Valor estable: un toast nuevo no vuelve a renderizar todos los consumidores del contexto
  const value = useMemo(() => ({ toast, showToast: toast }), [toast]);

  /** Deslizar un aviso hacia un lado o hacia arriba lo descarta (móvil) */
  const swipe = useRef<{ id: string; x: number; y: number; el: HTMLElement } | null>(null);
  const onTouchStart = (id: string) => (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    swipe.current = { id, x: t.clientX, y: t.clientY, el: e.currentTarget };
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = Math.min(0, t.clientY - s.y);
    s.el.style.transition = 'none';
    s.el.style.transform = `translate(${dx}px, ${dy}px)`;
    s.el.style.opacity = String(Math.max(0.2, 1 - Math.max(Math.abs(dx), Math.abs(dy) * 2) / 220));
  };
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 70 || dy < -36) {
      s.el.style.transition = 'transform .18s ease, opacity .18s ease';
      s.el.style.transform = Math.abs(dx) > 70 ? `translateX(${Math.sign(dx) * 120}%)` : 'translateY(-120%)';
      s.el.style.opacity = '0';
      setTimeout(() => remove(s.id), 170);
    } else {
      s.el.style.transition = 'transform .2s cubic-bezier(.16, 1, .3, 1), opacity .2s ease';
      s.el.style.transform = '';
      s.el.style.opacity = '';
    }
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-root" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.type}`}
            role={t.type === 'error' || t.type === 'warning' ? 'alert' : 'status'}
            onTouchStart={onTouchStart(t.id)}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            {t.type === 'success' && <CheckCircle2 aria-hidden="true" />}
            {t.type === 'reward' && <Gift aria-hidden="true" />}
            {t.type === 'info' && <Info aria-hidden="true" />}
            {t.type === 'warning' && <AlertCircle aria-hidden="true" />}
            {t.type === 'error' && <AlertTriangle aria-hidden="true" />}
            <div className="toast-body">
              <span>{t.message}</span>
              {t.sub && <small>{t.sub}</small>}
            </div>
            <button type="button" className="toast-close" onClick={() => remove(t.id)} aria-label="Cerrar notificación">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
