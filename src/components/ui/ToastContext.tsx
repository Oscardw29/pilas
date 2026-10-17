import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { CheckCircle2, Gift, Info, AlertTriangle, AlertCircle, X } from 'lucide-react';

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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'success', sub?: string) => {
      const id = Math.random().toString(36).slice(2, 9);
      const kind: ToastKind = type === 'danger' ? 'error' : type;

      // Máximo 5 mensajes a la vez
      setToasts((prev) => [...prev, { id, type: kind, message, sub }].slice(-5));
      timers.current.set(id, setTimeout(() => remove(id), DURATION_MS[kind]));
    },
    [remove]
  );

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
