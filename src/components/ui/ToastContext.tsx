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
      timers.current.set(item.id, setTimeout(() => remove(item.id), DURATION_MS[item.type]));
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

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-root" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} role={t.type === 'error' || t.type === 'warning' ? 'alert' : 'status'}>
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
