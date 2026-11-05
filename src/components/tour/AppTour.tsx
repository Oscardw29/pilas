import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSocial } from '@/social/useSocial';
import { CoachAvatar } from '@/components/coach/CoachAvatar';
import { useCoachPersona } from '@/components/coach/coachPersona';
import { stopCoachVoice } from '@/lib/coachVoice';
import { playSound } from '@/lib/sound';
import { useTour } from './tourStore';
import { resolveTarget, tourSteps, type TourStep } from './tourSteps';
import './tour.css';

/**
 * TUTORIAL GUIADO (primer uso)
 * El coach lleva a la persona por cada sección: oscurece toda la app menos lo que explica, que queda resaltado con un
 * borde. En el paso del primer hábito deja tocar el botón «Nuevo hábito» y espera a que se guarde. Se puede saltar en
 * cualquier momento (no vuelve a salir) y el creador lo puede repetir desde su panel. Sin voz: el coach solo muestra el texto.
 */

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface View {
  rect: Box | null;
  /** Hay un modal abierto (p. ej. el de crear hábito): el tutorial se aparta */
  modal: boolean;
  /** Lo resaltado es el botón «Más» del teléfono */
  viaMore: boolean;
}

const PAD = 8;
const GAP = 14;
const EDGE = 10;

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

/** Dónde va la tarjeta del coach: al lado de lo resaltado, debajo, encima o abajo del todo */
function placeCard(hole: Box | null, card: { w: number; h: number }, vw: number, vh: number): { top: number; left: number } {
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), vw - card.w - EDGE);
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), vh - card.h - EDGE);
  if (!hole) return { top: clampY((vh - card.h) / 2), left: clampX((vw - card.w) / 2) };
  const right = hole.left + hole.width;
  const bottom = hole.top + hole.height;
  const midY = hole.top + hole.height / 2 - card.h / 2;
  const midX = hole.left + hole.width / 2 - card.w / 2;
  // A la derecha (barra lateral en escritorio)
  if (hole.width < vw * 0.4 && right + GAP + card.w <= vw - EDGE) return { top: clampY(midY), left: right + GAP };
  if (bottom + GAP + card.h <= vh - EDGE) return { top: bottom + GAP, left: clampX(midX) };
  if (hole.top - GAP - card.h >= EDGE) return { top: hole.top - GAP - card.h, left: clampX(midX) };
  if (hole.left - GAP - card.w >= EDGE) return { top: clampY(midY), left: hole.left - GAP - card.w };
  // Lo resaltado ocupa casi toda la pantalla: la tarjeta va abajo
  return { top: vh - card.h - EDGE, left: clampX(midX) };
}

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export const AppTour: React.FC = () => {
  const active = useTour((s) => s.active);
  const index = useTour((s) => s.index);
  const manual = useTour((s) => s.manual);
  const go = useTour((s) => s.go);
  const stop = useTour((s) => s.stop);
  const start = useTour((s) => s.start);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const persona = useCoachPersona();
  const pending = useStore((s) => Boolean(s.settings.tutorialPending));
  const habitCount = useStore((s) => s.habits.length);
  const updateSettings = useStore((s) => s.updateSettings);
  const social = useSocial((s) => s.available);
  const [created, setCreated] = useState(false);

  const steps = useMemo(() => tourSteps({ social, created }), [social, created]);
  const step: TourStep | undefined = active ? steps[Math.min(index, steps.length - 1)] : undefined;
  const isLast = index >= steps.length - 1;
  const text = !step ? '' : typeof step.text === 'function' ? step.text(persona.name) : step.text;

  /* ---------- Arranque automático tras la bienvenida del primer uso ---------- */
  useEffect(() => {
    if (!pending || active) return;
    // Espera a que se cierre la bienvenida (y cualquier otro modal) antes de empezar
    let calm = 0;
    const timer = window.setInterval(() => {
      calm = document.querySelector('.modal-backdrop') ? 0 : calm + 1;
      if (calm >= 2) {
        window.clearInterval(timer);
        setCreated(false);
        start(false);
      }
    }, 350);
    return () => window.clearInterval(timer);
  }, [pending, active, start]);

  // Al empezar (también desde el panel del creador) se olvida el hábito de una vuelta anterior
  useEffect(() => {
    if (active) setCreated(false);
  }, [active]);

  const finish = useCallback(
    (completed: boolean) => {
      stopCoachVoice({ fade: true });
      stop();
      if (useStore.getState().settings.tutorialPending) updateSettings({ tutorialPending: false });
      if (completed) playSound.celebration();
      else playSound.modalClose();
    },
    [stop, updateSettings],
  );

  const next = useCallback(() => {
    playSound.click();
    if (isLast) finish(true);
    else go(index + 1);
  }, [finish, go, index, isLast]);

  const back = useCallback(() => {
    if (index === 0) return;
    playSound.click();
    // Volver desde «¡Primer hábito listo!» salta el paso de crearlo (ya está hecho)
    const prev = steps[index - 1]?.createHabit && created ? index - 2 : index - 1;
    go(Math.max(0, prev));
  }, [created, go, index, steps]);

  /* ---------- Al entrar en cada paso: ir a su sección ---------- */
  const habitBase = useRef(habitCount);
  useEffect(() => {
    if (!step) return;
    if (step.route && pathname !== step.route) navigate(step.route);
    // Los pasos sin nada que resaltar se ven con la página desde arriba
    else if (!step.targets) window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    habitBase.current = useStore.getState().habits.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  // El tutorial va en silencio: si el coach estaba hablando en otra parte, se calla al empezar
  useEffect(() => {
    if (active) stopCoachVoice({ fade: true });
  }, [active]);

  /* ---------- Paso del primer hábito: avanza cuando se guarda ---------- */
  const advanceWhenFree = useRef(false);
  useEffect(() => {
    if (!step?.createHabit || habitCount <= habitBase.current) return;
    setCreated(true);
    advanceWhenFree.current = true;
  }, [habitCount, step?.createHabit]);

  /* ---------- Seguir a lo resaltado (scroll, cambios de tamaño, carga de la página) ---------- */
  const [view, setView] = useState<View>({ rect: null, modal: false, viaMore: false });
  const viewRef = useRef(view);
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let scrolled = false;
    const tick = () => {
      const modal = Boolean(document.querySelector('.modal-backdrop'));
      const el = resolveTarget(step.targets);
      let rect: Box | null = null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (!scrolled) {
          scrolled = true;
          // Solo si lo resaltado no se ve entero (la barra lateral llega justo al borde y no hace falta moverla)
          if (r.top < 0 || r.bottom > window.innerHeight) {
            el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
          }
        }
        rect = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
      }
      const viaMore = Boolean(el?.matches('[data-tour="nav-more"]'));
      const prev = viewRef.current;
      if (!sameBox(prev.rect, rect) || prev.modal !== modal || prev.viaMore !== viaMore) {
        viewRef.current = { rect, modal, viaMore };
        setView(viewRef.current);
      }
      if (advanceWhenFree.current && !modal) {
        advanceWhenFree.current = false;
        window.setTimeout(() => useTour.getState().go(useTour.getState().index + 1), 250);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  /* ---------- Tamaño de la tarjeta (para colocarla) ---------- */
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setCardSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step?.id, view.modal]);

  // El botón principal recibe el foco en cada paso (teclado y lectores de pantalla)
  const primaryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (step && !view.modal) primaryRef.current?.focus({ preventScroll: true });
  }, [step?.id, view.modal]);

  /* ---------- Teclado: Escape salta, flechas avanzan y retroceden ---------- */
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal-backdrop')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      } else if (e.key === 'ArrowRight' && !step.createHabit) {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, finish, next, step]);

  if (!step) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;

  // Con el formulario del hábito abierto, el tutorial solo deja un recordatorio que no estorba
  if (view.modal) {
    return createPortal(
      <div className="tour-hint" role="status">
        <span className="tour-hint-face" aria-hidden="true">
          <CoachAvatar gender={persona.gender} crop="head" size={30} expression="happy" followPointer={false} />
        </span>
        {step.createHabit ? 'Completa los datos y guarda tu hábito. Aquí te espero.' : `${persona.name} te espera al cerrar esta ventana.`}
      </div>,
      document.body,
    );
  }

  const hole = view.rect;
  const pos = placeCard(hole, cardSize, vw, vh);
  const total = steps.length;
  const showBack = index > 0;

  return createPortal(
    <div className="tour-root">
      {hole ? (
        <>
          {/* Cuatro bandas alrededor del hueco: oscurecen y no dejan tocar el resto de la app */}
          <div className="tour-block" style={{ top: 0, left: 0, width: '100%', height: Math.max(0, hole.top) }} />
          <div className="tour-block" style={{ top: hole.top + hole.height, left: 0, width: '100%', bottom: 0 }} />
          <div className="tour-block" style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div className="tour-block" style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          {!step.interactive && <div className="tour-block clear" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />}
          <div
            className={`tour-spot${step.interactive ? ' is-interactive' : ''}`}
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="tour-block tour-dim-full" />
      )}

      <div
        ref={cardRef}
        className={`tour-card${hole ? '' : ' is-center'}`}
        style={{ top: pos.top, left: pos.left }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        key={step.id}
      >
        <div className="tour-card-head">
          <span className="tour-face" aria-hidden="true">
            <CoachAvatar
              gender={persona.gender}
              crop="bust"
              size={76}
              expression={step.id === 'created' || step.id === 'end' ? 'excited' : 'happy'}
              gesture={step.id === 'intro' ? 'wave' : step.id === 'created' || step.id === 'end' ? 'cheer' : 'explain'}
              gestureKey={index + 1}
              followPointer={false}
            />
          </span>
          <div className="tour-card-titles">
            <span className="tour-step-count">
              {persona.name} · {index + 1} de {total}
            </span>
            <h2 id="tour-title" className="tour-title">
              {step.title}
            </h2>
          </div>
          <button type="button" className="icon-btn sm" onClick={() => finish(false)} aria-label="Saltar el tutorial" title="Saltar el tutorial" data-no-sound="true">
            <X size={16} />
          </button>
        </div>

        <p id="tour-text" className="tour-text" aria-live="polite">
          {text}
        </p>
        {view.viaMore && <p className="tour-note">Lo encuentras dentro de «Más», en la barra de abajo.</p>}
        {step.createHabit && hole && <p className="tour-note">Toca el botón resaltado.</p>}
        {manual && step.id === 'intro' && <p className="tour-note">Vista del creador: los hábitos que crees aquí son reales.</p>}

        <div className="tour-progress" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s.id} className={i === index ? 'on' : i < index ? 'done' : ''} />
          ))}
        </div>

        <div className="tour-actions">
          {showBack ? (
            <button type="button" className="btn btn-ghost sm" onClick={back} data-no-sound="true">
              <ArrowLeft size={14} /> Atrás
            </button>
          ) : (
            <button type="button" className="btn btn-ghost sm" onClick={() => finish(false)} data-no-sound="true">
              Saltar
            </button>
          )}
          {step.createHabit ? (
            <button ref={primaryRef} type="button" className="btn btn-secondary sm" onClick={next} data-no-sound="true">
              Lo haré después
            </button>
          ) : (
            <button ref={primaryRef} type="button" className="btn btn-primary sm" onClick={next} data-no-sound="true">
              {isLast ? '¡Empezar!' : index === 0 ? 'Vamos' : 'Siguiente'} {!isLast && <ArrowRight size={14} />}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
