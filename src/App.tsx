import React, { lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from './components/layout/Shell';
import { playSound } from './lib/sound';
import { registerServiceWorker, runNotificationCheck } from './lib/notifications';
import { useStore } from './store/useStore';
import { useToast } from './components/ui/ToastContext';
import { longDate, todayKey } from './lib/dates';


// Cada vista se carga bajo demanda (code-splitting): el arranque descarga mucho menos JavaScript
const DashboardView = lazy(() => import('./views/DashboardView').then((m) => ({ default: m.DashboardView })));
const GoalsView = lazy(() => import('./views/GoalsView').then((m) => ({ default: m.GoalsView })));
const GoalDetailView = lazy(() => import('./views/GoalDetailView').then((m) => ({ default: m.GoalDetailView })));
const WeekView = lazy(() => import('./views/WeekView').then((m) => ({ default: m.WeekView })));
const CalendarView = lazy(() => import('./views/CalendarView').then((m) => ({ default: m.CalendarView })));
const TimerView = lazy(() => import('./views/TimerView').then((m) => ({ default: m.TimerView })));
const InsightsView = lazy(() => import('./views/InsightsView').then((m) => ({ default: m.InsightsView })));
const ReviewView = lazy(() => import('./views/ReviewView').then((m) => ({ default: m.ReviewView })));
const ChallengesView = lazy(() => import('./views/ChallengesView').then((m) => ({ default: m.ChallengesView })));
const ExperimentsView = lazy(() => import('./views/ExperimentsView').then((m) => ({ default: m.ExperimentsView })));
const HabitMapView = lazy(() => import('./views/HabitMapView').then((m) => ({ default: m.HabitMapView })));
const RewardsView = lazy(() => import('./views/RewardsView').then((m) => ({ default: m.RewardsView })));
const AiCoachView = lazy(() => import('./views/AiCoachView').then((m) => ({ default: m.AiCoachView })));
const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })));

export const App: React.FC = () => {
  const { toast } = useToast();

  // Protector de racha: se consume solo al abrir la app (o al cambiar de día) si salvó un día roto
  useEffect(() => {
    let lastDay = '';
    const check = () => {
      const today = todayKey();
      if (today === lastDay) return;
      lastDay = today;
      const saved = useStore.getState().applyStreakFreeze(today);
      if (saved) toast(`Tu protector de racha salvó el ${longDate(saved)}`, 'reward');
    };
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [toast]);

  // Aviso si el navegador no deja guardar (cuota llena o almacenamiento bloqueado)
  useEffect(() => {
    const onStorageError = () =>
      toast('No se pudieron guardar tus datos en este navegador', 'error', 'Exporta un respaldo desde Ajustes para no perder cambios.');
    window.addEventListener('constancia:storage-error', onStorageError);
    return () => window.removeEventListener('constancia:storage-error', onStorageError);
  }, [toast]);

  useEffect(() => {
    let lastSoundTime = 0;

    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const interactiveEl = target.closest<HTMLElement>(
        'button, .btn, .icon-btn, [role="button"], .tab, .chip, input[type="checkbox"], input[type="radio"], nav a'
      );

      if (!interactiveEl) return;
      if (interactiveEl.getAttribute('data-no-sound') === 'true') return;

      const now = Date.now();
      if (now - lastSoundTime < 60) return;
      lastSoundTime = now;

      if (interactiveEl.tagName === 'INPUT' && (interactiveEl as HTMLInputElement).type === 'checkbox') {
        playSound.toggle();
      } else {
        playSound.click();
      }
    };

    document.addEventListener('click', handleGlobalClick, true);
    return () => {
      document.removeEventListener('click', handleGlobalClick, true);
    };
  }, []);

  useEffect(() => {
    // Registrar Service Worker para notificaciones nativas en celulares y Windows
    void registerServiceWorker();

    // Chequeo inmediato al montar la app y luego periódico (los recordatorios tienen margen de recuperación)
    void runNotificationCheck();
    const timer = setInterval(() => {
      void runNotificationCheck();
    }, 25000);

    return () => clearInterval(timer);
  }, []);

  return (
    <Routes>
      <Route element={<Shell />}>
        {/* Inicio */}
        <Route path="/" element={<DashboardView />} />

        {/* Objetivos */}
        <Route path="/objetivos" element={<GoalsView />} />
        <Route path="/goals" element={<GoalsView />} />
        <Route path="/objetivos/:id" element={<GoalDetailView />} />
        <Route path="/goals/:id" element={<GoalDetailView />} />

        {/* Mi Semana / Matriz */}
        <Route path="/semana" element={<WeekView />} />
        <Route path="/week" element={<WeekView />} />

        {/* Calendario Histórico */}
        <Route path="/calendario" element={<CalendarView />} />
        <Route path="/calendar" element={<CalendarView />} />

        {/* Temporizador */}
        <Route path="/temporizador" element={<TimerView />} />
        <Route path="/timer" element={<TimerView />} />

        {/* Insights & Decisiones */}
        <Route path="/insights" element={<InsightsView />} />

        {/* Revisión Semanal */}
        <Route path="/revision" element={<ReviewView />} />
        <Route path="/review" element={<ReviewView />} />

        {/* Retos 30d */}
        <Route path="/retos" element={<ChallengesView />} />
        <Route path="/challenges" element={<ChallengesView />} />

        {/* Experimentos */}
        <Route path="/experimentos" element={<ExperimentsView />} />
        <Route path="/experiments" element={<ExperimentsView />} />

        {/* Mapa de Hábitos */}
        <Route path="/mapa" element={<HabitMapView />} />
        <Route path="/map" element={<HabitMapView />} />

        {/* Recompensas */}
        <Route path="/recompensas" element={<RewardsView />} />
        <Route path="/rewards" element={<RewardsView />} />

        {/* Coach IA */}
        <Route path="/coach" element={<AiCoachView />} />

        {/* Ajustes */}
        <Route path="/ajustes" element={<SettingsView />} />
        <Route path="/settings" element={<SettingsView />} />

        {/* Wildcard */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
};

export default App;
