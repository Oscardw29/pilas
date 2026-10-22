import React, { Suspense, useState, useMemo, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  Target,
  Calendar,
  CalendarDays,
  Timer,
  Lightbulb,
  FileCheck2,
  Trophy,
  FlaskConical,
  GitFork,
  Gift,
  Settings,
  Zap,
  Play,
  Pause,
  Square,
  Maximize2,
  X,
  LayoutGrid,
  type LucideIcon,
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { pointsSummary, levelFromXp } from '@/lib/metrics';
import { formatClock, todayKey } from '@/lib/dates';
import { SessionFinishModal } from '@/components/modals/SessionFinishModal';
import { EnergyModal } from '@/components/modals/EnergyModal';
import { TimerModal } from '@/components/modals/TimerModal';
import { StreakCelebrationOverlay } from '@/components/ui/StreakCelebrationOverlay';
import { RewardCelebrationOverlay } from '@/components/ui/RewardCelebrationOverlay';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { playSound } from '@/lib/sound';
import { useElapsed } from '@/lib/timer';
import { TimerCompletionWatcher } from './TimerCompletionWatcher';
import { WelcomeModal } from '@/components/modals/WelcomeModal';
import { FloatingCoachChat } from '@/components/coach/FloatingCoachChat';
import { BrandMark, BrandWordmark } from '@/components/ui/BrandMark';
import { CoachIcon } from '@/components/ui/icons';
import { useCoachPersona } from '@/components/coach/coachPersona';
import { SyncPill } from '@/components/auth/SyncPill';

interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: LucideIcon | typeof CoachIcon;
}

/** Navegación agrupada: la misma estructura para sidebar (escritorio), rail (tablet) y hoja «Más» (móvil) */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Principal',
    items: [
      { to: '/', label: 'Inicio', icon: Home },
      { to: '/objetivos', label: 'Objetivos', icon: Target },
      { to: '/semana', label: 'Mi semana', short: 'Semana', icon: Calendar },
      { to: '/temporizador', label: 'Temporizador', icon: Timer },
      // El nombre real (Pilo o Pila) se pone al renderizar según el género elegido
      { to: '/coach', label: 'Coach', icon: CoachIcon },
    ],
  },
  {
    label: 'Seguimiento',
    items: [
      { to: '/calendario', label: 'Calendario', icon: CalendarDays },
      { to: '/revision', label: 'Revisión semanal', short: 'Revisión', icon: FileCheck2 },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { to: '/insights', label: 'Insights & Decisiones', short: 'Insights', icon: Lightbulb },
      { to: '/mapa', label: 'Mapa de hábitos', short: 'Mapa', icon: GitFork },
      { to: '/experimentos', label: 'Experimentos', icon: FlaskConical },
    ],
  },
  {
    label: 'Motivación',
    items: [
      { to: '/retos', label: 'Retos 30d', short: 'Retos', icon: Trophy },
      { to: '/recompensas', label: 'Recompensas', icon: Gift },
    ],
  },
  {
    label: 'Sistema',
    items: [{ to: '/ajustes', label: 'Ajustes', icon: Settings }],
  },
];

/** Pestañas fijas de la barra inferior en móvil; el resto vive en «Más» */
const BOTTOM_TABS = ['/', '/semana', '/objetivos', '/coach'];

const isActivePath = (pathname: string, to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

export const Shell: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const logs = useStore((s) => s.logs);
  const pointEvents = useStore((s) => s.pointEvents);
  const redemptions = useStore((s) => s.redemptions);
  const activeTimer = useStore((s) => s.activeTimer);
  const isTimerModalOpen = useStore((s) => s.isTimerModalOpen);
  const setTimerModalOpen = useStore((s) => s.setTimerModalOpen);
  const habits = useStore((s) => s.habits);
  const pauseTimer = useStore((s) => s.pauseTimer);
  const resumeTimer = useStore((s) => s.resumeTimer);
  const cancelTimer = useStore((s) => s.cancelTimer);
  const energySetToday = useStore((s) => s.energy.some((e) => e.date === todayKey()));

  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showEnergyModal, setShowEnergyModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const coachName = useCoachPersona().name;
  const navGroups = useMemo(
    () => NAV_GROUPS.map((g) => ({ ...g, items: g.items.map((i) => (i.to === '/coach' ? { ...i, label: coachName } : i)) })),
    [coachName],
  );
  const allItems = useMemo(() => navGroups.flatMap((g) => g.items), [navGroups]);

  // Cerrar la hoja «Más» al navegar
  useEffect(() => {
    setShowMore(false);
    window.scrollTo({ top: 0 });
  }, [pathname]);

  // Memo: el cronómetro re-renderiza cada segundo y no hace falta recorrer todos los registros
  const pts = useMemo(() => pointsSummary({ logs, pointEvents, redemptions }), [logs, pointEvents, redemptions]);
  const levelInfo = useMemo(() => levelFromXp(pts.earned), [pts.earned]);

  // Cronómetro del temporizador activo (por diferencia de tiempo: no deriva)
  const timerSeconds = useElapsed(activeTimer);
  const timerHabit = activeTimer ? habits.find((h) => h.id === activeTimer.habitId) : null;
  const showTimerBar = Boolean(activeTimer && (timerHabit || activeTimer.isCustom) && !isTimerModalOpen && pathname !== '/temporizador');
  const timerTitle = activeTimer?.isCustom ? activeTimer.customTitle || 'Temporizador libre' : timerHabit?.name;
  const timerIcon = activeTimer?.isCustom ? activeTimer.customIcon : timerHabit?.icon;

  const currentItem = allItems.find((i) => isActivePath(pathname, i.to));
  const moreActive = !BOTTOM_TABS.some((to) => isActivePath(pathname, to));

  return (
    <div className="app-shell">
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>

      {/* SIDEBAR (escritorio) / RAIL DE ICONOS (tablet) */}
      <aside className="sidebar" aria-label="Navegación principal">
        <div className="sidebar-brand">
          <NavLink to="/" className="brand" aria-label="¡Pilas!, ir al inicio" data-no-sound="true">
            <BrandMark size={34} className="brand-logo" />
            <BrandWordmark className="brand-name" />
          </NavLink>
          <button
            type="button"
            className={`icon-btn sm energy-btn${energySetToday ? '' : ' energy-btn--pending'}`}
            onClick={() => setShowEnergyModal(true)}
            title="Registrar nivel de energía de hoy"
            aria-label="Registrar nivel de energía de hoy"
          >
            <Zap size={16} />
          </button>
          <SyncPill compact />
        </div>

        <div className="level-card" aria-label={`Nivel ${levelInfo.level}, ${pts.balance} puntos`}>
          <div className="row-between">
            <span className="level-card-level">Nivel {levelInfo.level}</span>
            <span className="level-card-points">{pts.balance} pts</span>
          </div>
          <div className="progress thin" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(levelInfo.progress * 100)}>
            <div style={{ width: `${Math.round(levelInfo.progress * 100)}%` }} />
          </div>
        </div>

        <nav className="side-nav">
          {navGroups.map((group) => (
            <div key={group.label} className="nav-group">
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  data-no-sound="true"
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  title={item.label}
                >
                  <item.icon size={18} aria-hidden="true" />
                  <span className="nav-link-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* CONTENEDOR PRINCIPAL */}
      <main className="app-main">
        {/* BARRA SUPERIOR (móvil) */}
        <header className="mobile-topbar">
          <div className="brand">
            <BrandMark size={28} className="brand-logo sm" />
            <span className="mobile-topbar-title">{currentItem?.label ?? '¡Pilas!'}</span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <SyncPill compact />
            <button
              type="button"
              className={`icon-btn energy-btn${energySetToday ? '' : ' energy-btn--pending'}`}
              onClick={() => setShowEnergyModal(true)}
              aria-label="Registrar nivel de energía de hoy"
            >
              <Zap size={18} />
            </button>
            <span className="badge accent" aria-label={`${pts.balance} puntos`}>
              {pts.balance} pts
            </span>
          </div>
        </header>

        {/* TEMPORIZADOR ACTIVO MINIMIZADO: barra en tablet/escritorio, pastilla flotante en móvil */}
        {showTimerBar && activeTimer && (
          <div className={`timer-bar ${activeTimer.pausedAt ? 'paused' : ''}`} role="region" aria-label="Temporizador activo">
            <button type="button" className="timer-bar-info" onClick={() => setTimerModalOpen(true)} title="Abrir el temporizador" aria-label="Abrir el temporizador">
              <span className="timer-bar-icon" aria-hidden="true">
                {timerIcon || <Timer size={20} />}
              </span>
              <span className="timer-bar-text">
                <span className="timer-bar-title truncate">{timerTitle}</span>
                <span className="timer-bar-status">{activeTimer.pausedAt ? 'En pausa' : 'Sesión en progreso'}</span>
              </span>
            </button>

            <span className="timer-bar-clock" aria-live="off">
              {formatClock(timerSeconds)}
            </span>

            <div className="timer-bar-actions">
              {activeTimer.pausedAt ? (
                <button type="button" className="btn btn-secondary sm" onClick={resumeTimer} aria-label="Reanudar sesión">
                  <Play size={14} /> <span className="hide-sm">Reanudar</span>
                </button>
              ) : (
                <button type="button" className="btn btn-secondary sm" onClick={pauseTimer} aria-label="Pausar sesión">
                  <Pause size={14} /> <span className="hide-sm">Pausar</span>
                </button>
              )}
              <button type="button" className="btn btn-secondary sm hide-sm" onClick={() => setTimerModalOpen(true)}>
                <Maximize2 size={14} /> Ver reloj
              </button>
              <button type="button" className="btn btn-primary sm" onClick={() => setShowFinishModal(true)} aria-label="Terminar sesión">
                <Square size={14} /> <span className="hide-sm">Terminar</span>
              </button>
              <button
                type="button"
                className="icon-btn sm danger hide-sm"
                onClick={() => setShowCancelConfirm(true)}
                aria-label="Descartar y cancelar temporizador"
                title="Descartar y cancelar temporizador"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        {/* VISTA RENDERIZADA */}
        <div id="contenido" className="page-container" tabIndex={-1}>
          <Suspense
            fallback={
              <div className="page-loading" role="status" aria-live="polite">
                <span className="spinner" aria-hidden="true" />
                Cargando…
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* BARRA INFERIOR (móvil) */}
      <nav className="bottom-nav" aria-label="Navegación rápida">
        {BOTTOM_TABS.map((to) => {
          const item = allItems.find((i) => i.to === to)!;
          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              data-no-sound="true"
              className={({ isActive }) => `bottom-tab ${isActive ? 'active' : ''}`}
            >
              <item.icon size={20} aria-hidden="true" />
              <span>{item.short ?? item.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          className={`bottom-tab ${moreActive ? 'active' : ''}`}
          onClick={() => setShowMore(true)}
          aria-haspopup="dialog"
          aria-expanded={showMore}
        >
          <LayoutGrid size={20} aria-hidden="true" />
          <span>Más</span>
        </button>
      </nav>

      {/* HOJA «MÁS» (móvil): resto de secciones agrupadas */}
      <Modal isOpen={showMore} onClose={() => setShowMore(false)} title="Todas las secciones">
        <div className="more-sheet">
          {navGroups.map((group) => {
            const items = group.items.filter((i) => !BOTTOM_TABS.includes(i.to));
            if (items.length === 0) return null;
            return (
              <section key={group.label} className="more-group">
                <h3 className="nav-group-label">{group.label}</h3>
                <div className="more-grid">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      data-no-sound="true"
                      className={({ isActive }) => `more-item ${isActive ? 'active' : ''}`}
                    >
                      <item.icon size={22} aria-hidden="true" />
                      <span>{item.short ?? item.label}</span>
                    </NavLink>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </Modal>

      {/* MODAL PARA TERMINAR SESIÓN */}
      {showFinishModal && (
        <SessionFinishModal
          isOpen={showFinishModal}
          onClose={() => setShowFinishModal(false)}
          onFinished={() => {
            setShowFinishModal(false);
            navigate('/temporizador');
          }}
        />
      )}

      {/* MODAL DE REGISTRO RÁPIDO DE ENERGÍA */}
      {showEnergyModal && <EnergyModal isOpen={showEnergyModal} onClose={() => setShowEnergyModal(false)} />}

      {/* CONFIRMAR CANCELACIÓN DE TEMPORIZADOR */}
      {showCancelConfirm && (
        <ConfirmModal
          isOpen={showCancelConfirm}
          title="¿Cancelar temporizador?"
          message="¿Seguro que deseas descartar esta sesión de temporizador? El tiempo transcurrido no se guardará."
          confirmLabel="Sí, descartar"
          danger
          onConfirm={() => {
            cancelTimer();
            setShowCancelConfirm(false);
            playSound.delete();
          }}
          onClose={() => setShowCancelConfirm(false)}
        />
      )}

      {/* MODAL GLOBAL DE TEMPORIZADOR CIRCULAR + aviso al completar */}
      <TimerModal />
      <TimerCompletionWatcher />

      {/* BIENVENIDA DEL PRIMER USO */}
      <WelcomeModal />

      {/* CHAT FLOTANTE DEL COACH (todas las páginas excepto la suya) */}
      <FloatingCoachChat />

      {/* OVERLAYS DE CELEBRACIÓN */}
      <StreakCelebrationOverlay />
      <RewardCelebrationOverlay />
    </div>
  );
};
