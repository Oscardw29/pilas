import React, { useEffect, useRef, useState } from 'react';
import { myRating, rateApp, type RatingSummary } from '@/lib/appRating';

/**
 * CALIFICACIÓN DE /descargar: el sello que gira junto al titular y la sección con las cinco estrellas.
 * Solo estrellas y la media (sin comentarios). Los datos viven en Supabase (src/lib/appRating.ts).
 */

export type RatingState = { status: 'loading' } | { status: 'ready'; summary: RatingSummary } | { status: 'error' };

const LABELS = ['', 'No me gustó', 'Le falta', 'Normalita', 'Bacana', '¡Qué chévere!'];

const fmt = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const votes = (n: number) => `${n.toLocaleString('es-CO')} ${n === 1 ? 'calificación' : 'calificaciones'}`;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Estrella redondeada (la misma silueta para pintar, rellenar a medias y los botones) */
const STAR = 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z';

const StarShape: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={STAR} />
  </svg>
);

/** Cinco estrellas rellenas según la media (una puede quedar a medias) */
export const StarRow: React.FC<{ value: number; className?: string }> = ({ value, className = '' }) => (
  <span className={`dl-stars ${className}`} aria-hidden="true">
    {[0, 1, 2, 3, 4].map((i) => (
      <span key={i} className="dl-star" style={{ '--fill': `${Math.max(0, Math.min(1, value - i)) * 100}%`, '--n': i } as React.CSSProperties}>
        <StarShape className="dl-star-back" />
        <StarShape className="dl-star-front" />
      </span>
    ))}
  </span>
);

/**
 * Cuenta hasta el valor cuando `run` se activa: la primera vez desde 0 (con `delay`), después desde lo que ya se ve
 * (al votar la media se mueve un poco, sin volver a empezar). Sin animación con «reducir movimiento».
 */
function useCountUp(value: number, run: boolean, delay = 0, duration = 1100) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  const started = useRef(false);
  useEffect(() => {
    if (!run) return;
    if (reducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }
    const start = current.current;
    const wait = started.current ? 0 : delay;
    const time = started.current ? 600 : duration;
    let raf = 0;
    const from = performance.now() + wait;
    const tick = (t: number) => {
      const p = Math.max(0, Math.min(1, (t - from) / time));
      if (p > 0) started.current = true;
      current.current = start + (value - start) * (1 - Math.pow(1 - p, 3));
      setShown(current.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, run, delay, duration]);
  return shown;
}

/** Borde ondulado del sello: un círculo con 16 ondas, sin esquinas */
const SEAL_PATH = (() => {
  const n = 16;
  const step = (Math.PI * 2) / n;
  const pt = (a: number, r: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  let d = `M ${pt(0, 44)}`;
  for (let i = 0; i < n; i++) d += ` Q ${pt((i + 0.5) * step, 55)} ${pt((i + 1) * step, 44)}`;
  return `${d} Z`;
})();

/** Sello junto al titular: entra girando, cuenta la media y rellena las estrellas una a una. Lleva a la sección */
export const RatingSeal: React.FC<{ state: RatingState }> = ({ state }) => {
  // Si los datos llegan tarde, entra enseguida; si no, espera a que termine la entrada del titular
  const delay = useRef(Math.max(150, 1100 - (typeof performance !== 'undefined' ? performance.now() : 0))).current;
  const ready = state.status === 'ready';
  const summary = ready ? state.summary : { average: 0, count: 0 };
  const shown = useCountUp(summary.average, ready, delay + 350);
  if (!ready) return null;
  const empty = summary.count === 0;
  return (
    <a
      className={`dl-seal${empty ? ' is-empty' : ''}`}
      href="#calificar"
      style={{ '--seal-delay': `${delay}ms` } as React.CSSProperties}
      aria-label={empty ? 'Todavía nadie ha calificado ¡Pilas!: sé el primero' : `¡Pilas! tiene ${fmt(summary.average)} de 5 estrellas, ${votes(summary.count)}. Ir a calificar`}
    >
      <svg className="dl-seal-ring" viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
        <path d={SEAL_PATH} />
      </svg>
      <span className="dl-seal-in" aria-hidden="true">
        {empty ? (
          <>
            <span className="dl-seal-kicker">Sé el primero</span>
            <StarRow value={0} className="dl-seal-stars" />
            <span className="dl-seal-big is-word">¡Califica!</span>
          </>
        ) : (
          <>
            <span className="dl-seal-big">{fmt(shown)}</span>
            <StarRow value={shown} className="dl-seal-stars" />
            <span className="dl-seal-kicker">
              {summary.count.toLocaleString('es-CO')} {summary.count === 1 ? 'voto' : 'votos'}
            </span>
          </>
        )}
      </span>
    </a>
  );
};

/** La sección: la media en grande y cinco estrellas para votar (se puede cambiar el voto) */
export const RatingPanel: React.FC<{ state: RatingState; onRated: (s: RatingSummary) => void }> = ({ state, onRated }) => {
  const [mine, setMine] = useState<number | null>(() => myRating());
  const [hover, setHover] = useState(0);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [burst, setBurst] = useState<{ n: number; key: number } | null>(null);
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setSeen(true), io.disconnect()), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const ready = state.status === 'ready';
  const summary = ready ? state.summary : { average: 0, count: 0 };
  const shown = useCountUp(summary.average, ready && seen, 150);

  const vote = async (n: number) => {
    if (sending) return;
    setBurst({ n, key: Date.now() });
    const before = mine;
    setMine(n);
    setSending(true);
    setMessage(null);
    try {
      const next = await rateApp(n);
      onRated(next);
      setMessage(before ? `Listo, cambiaste tu nota a ${n} ${n === 1 ? 'estrella' : 'estrellas'}.` : `¡Gracias! Le pusiste ${n} ${n === 1 ? 'estrella' : 'estrellas'}.`);
    } catch (e) {
      setMine(before);
      setMessage(e instanceof Error && /calificaciones/.test(e.message) ? e.message : 'No se pudo guardar tu calificación. Revisa tu conexión y prueba otra vez.');
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: React.KeyboardEvent, n: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = Math.max(1, Math.min(5, n + d));
    btns.current[next - 1]?.focus();
    setHover(next);
  };

  const lit = hover || mine || 0;
  const hint = hover
    ? LABELS[hover]
    : message ?? (mine ? `Tu nota: ${mine} ${mine === 1 ? 'estrella' : 'estrellas'}. Si cambias de opinión, toca otra.` : 'Toca una estrella. Sin registrarte y sin escribir nada.');

  return (
    <div className="dl-rate-panel" ref={ref}>
      <div className="dl-rate-score" aria-live="polite">
        {state.status === 'error' ? (
          <p className="dl-rate-off">Las calificaciones no cargaron. Recarga la página en un ratico.</p>
        ) : (
          <>
            <span className="dl-rate-num">{ready ? fmt(shown) : '–'}</span>
            <div className="dl-rate-meta">
              <StarRow value={shown} className="dl-rate-avg" />
              <span>
                {!ready ? 'Cargando…' : summary.count === 0 ? 'Todavía nadie califica: ¡estrena tú!' : `de 5 · ${votes(summary.count)}`}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="dl-rate-pick">
        <p className="dl-rate-ask" id="dl-rate-ask">
          ¿Y tú cuántas le pones?
        </p>
        <div className="dl-rate-buttons" role="radiogroup" aria-labelledby="dl-rate-ask" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              ref={(el) => {
                btns.current[n - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={mine === n}
              aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}: ${LABELS[n]}`}
              tabIndex={(mine ?? 1) === n ? 0 : -1}
              disabled={state.status === 'error'}
              className={`${n <= lit ? 'is-lit' : ''}${hover && n <= hover ? ' is-hover' : ''}`}
              style={{ '--n': n } as React.CSSProperties}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(0)}
              onKeyDown={(e) => onKey(e, n)}
              onClick={() => void vote(n)}
            >
              <StarShape />
              {burst && burst.n === n && (
                <span className="dl-burst" key={burst.key} aria-hidden="true">
                  {Array.from({ length: 10 }, (_, i) => (
                    <span key={i} style={{ '--a': `${i * 36 + 8}deg`, '--d': `${70 + (i % 3) * 22}px` } as React.CSSProperties} />
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
        <p className={`dl-rate-hint${hover ? ' is-label' : ''}`} aria-live="polite">
          {hint}
        </p>
      </div>
    </div>
  );
};
