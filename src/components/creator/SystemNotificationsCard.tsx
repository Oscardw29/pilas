import React, { useState } from 'react';
import { Bell, Droplets, Flame, Moon, Send, Sparkles, Sun } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { personaFor } from '@/components/coach/coachPersona';
import { CustomTimePicker } from '@/components/ui/CustomTimePicker';
import { useToast } from '@/components/ui/ToastContext';
import { playSound } from '@/lib/sound';
import {
  DEFAULT_NOTIFICATIONS,
  getCoachVariants,
  getHabitVariants,
  getMiddayVariants,
  getMorningVariants,
  getNightVariants,
  getNotificationPermission,
  getStreakVariants,
  requestNotificationPermission,
  showSystemNotification,
} from '@/lib/notifications';
import type { NotificationSettings } from '@/types';

/**
 * NOTIFICACIONES DEL SISTEMA (panel del creador › Ajustes de prueba)
 * El detalle de los recordatorios (horas y tipos) y las pruebas de envío. Cada cambio se guarda al instante en los ajustes de
 * este dispositivo; en Ajustes todo el mundo (también el creador) solo ve el interruptor general.
 */


type TestKind = 'habit' | 'streak' | 'coach' | 'morning' | 'midday' | 'night';
type ToggleKey = 'habitReminders' | 'streakReminder' | 'coachReminder' | 'morningReminder' | 'middayReminder' | 'nightReminder';
type TimeKey = 'streakReminderTime' | 'coachReminderTime' | 'morningReminderTime' | 'middayReminderTime' | 'nightReminderTime';

interface ReminderDef {
  kind: TestKind;
  toggle: ToggleKey;
  time?: TimeKey;
  icon: React.ReactNode;
  label: string;
  hint: string;
}

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

const box: React.CSSProperties = { padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-2)' };

export const SystemNotificationsCard: React.FC = () => {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const habits = useStore((s) => s.habits);
  const { showToast } = useToast();
  const [permission, setPermission] = useState(getNotificationPermission);
  const [requesting, setRequesting] = useState(false);
  const [sending, setSending] = useState<TestKind | null>(null);

  const notif: NotificationSettings = { ...DEFAULT_NOTIFICATIONS, ...settings.notifications };
  const userName = settings.userName?.trim() || 'Usuario';
  const coachName = personaFor(settings.userGender || 'other').name;

  const set = (patch: Partial<NotificationSettings>) => updateSettings({ notifications: { ...notif, ...patch } });

  const handleRequestPermission = async () => {
    setRequesting(true);
    try {
      const perm = await requestNotificationPermission();
      setPermission(perm);
      if (perm === 'granted') {
        showToast('¡Permiso de notificaciones del sistema concedido!', 'success');
        playSound.celebration();
      } else if (perm === 'denied') {
        showToast('El permiso fue bloqueado en las preferencias del navegador o sistema.', 'error');
      } else {
        showToast('Permiso de notificaciones no activado.', 'warning');
      }
    } finally {
      setRequesting(false);
    }
  };

  const buildTest = (kind: TestKind): { title: string; body: string } | null => {
    switch (kind) {
      case 'habit': {
        const habit = habits.find((h) => h.status === 'active') ?? habits[0];
        return habit ? pick(getHabitVariants(habit, userName)) : null;
      }
      case 'streak':
        return pick(getStreakVariants(userName, 2, 5));
      case 'coach':
        return pick(getCoachVariants(userName));
      case 'morning':
        return pick(getMorningVariants(userName));
      case 'midday':
        return pick(getMiddayVariants(userName));
      case 'night':
        return pick(getNightVariants(userName));
    }
  };

  const sendTest = async (kind: TestKind) => {
    const payload = buildTest(kind);
    if (!payload) {
      showToast('Crea al menos un hábito para probar este recordatorio.', 'warning');
      return;
    }
    setSending(kind);
    try {
      const ok = await showSystemNotification({ ...payload, tag: `pilas-prueba-${kind}-${Date.now()}` });
      if (ok) showToast('Notificación de prueba enviada al sistema', 'success');
      else if (permission !== 'granted') showToast('Primero activa los permisos del sistema para poder enviarla.', 'warning');
      else showToast('El sistema no mostró la notificación. Revisa que no esté en modo «No molestar».', 'error');
    } finally {
      setSending(null);
    }
  };

  const reminders: ReminderDef[] = [
    {
      kind: 'habit',
      toggle: 'habitReminders',
      icon: <Bell size={15} style={{ color: 'var(--accent-2)' }} />,
      label: 'Recordatorios de hábitos en su hora fijada',
      hint: 'Avisa a la hora programada de cada hábito si aún no se ha completado hoy. Rota entre distintas frases.',
    },
    {
      kind: 'streak',
      toggle: 'streakReminder',
      time: 'streakReminderTime',
      icon: <Flame size={15} style={{ color: 'var(--warning)' }} />,
      label: 'Alerta para mantener la racha activa',
      hint: 'Avisa si quedan hábitos pendientes antes de que termine el día: la versión mínima también salva la racha.',
    },
    {
      kind: 'coach',
      toggle: 'coachReminder',
      time: 'coachReminderTime',
      icon: <Sparkles size={15} style={{ color: 'var(--accent-2)' }} />,
      label: `Mensaje de ${coachName} con tu nombre (${userName})`,
      hint: `Un mensaje motivacional de ${coachName}, sin gastar IA.`,
    },
    {
      kind: 'morning',
      toggle: 'morningReminder',
      time: 'morningReminderTime',
      icon: <Sun size={15} style={{ color: 'var(--warning)' }} />,
      label: 'Impulso matutino',
      hint: 'Para arrancar el día con los hábitos de la mañana.',
    },
    {
      kind: 'midday',
      toggle: 'middayReminder',
      time: 'middayReminderTime',
      icon: <Droplets size={15} style={{ color: 'var(--info)' }} />,
      label: 'Pausa e hidratación',
      hint: 'Una pausa a mitad del día.',
    },
    {
      kind: 'night',
      toggle: 'nightReminder',
      time: 'nightReminderTime',
      icon: <Moon size={15} style={{ color: 'var(--accent-2)' }} />,
      label: 'Cierre y descanso',
      hint: 'Para marcar lo del día antes de dormir.',
    },
  ];

  return (
    <div className="card" style={{ borderTop: '3px solid var(--accent)' }}>
      <div className="card-head" style={{ flexWrap: 'wrap' }}>
        <div>
          <h2 className="card-title">Notificaciones del sistema</h2>
          <p className="card-sub">
            Alertas nativas de Windows y del celular en este dispositivo. Ajusta cada recordatorio y pruébalo con «Probar»: la notificación
            llega al instante. Los cambios se guardan solos.
          </p>
        </div>
        {permission === 'granted' ? (
          <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.18)', color: 'var(--success)', fontWeight: 600 }}>
            Permiso concedido
          </span>
        ) : permission === 'denied' ? (
          <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.18)', color: 'var(--danger)', fontWeight: 600 }}>
            Bloqueado en el navegador / sistema
          </span>
        ) : permission === 'unsupported' ? (
          <span className="badge" style={{ fontWeight: 600 }}>No disponible aquí</span>
        ) : (
          <button type="button" className="btn btn-primary sm" onClick={handleRequestPermission} disabled={requesting}>
            <Bell size={13} /> Activar permisos del sistema
          </button>
        )}
      </div>

      <div className="form">
        <label className="custom-switch" style={{ paddingBottom: 12, borderBottom: '1px solid var(--border-2)' }}>
          <input
            type="checkbox"
            checked={notif.enabled}
            onChange={(e) => {
              set({ enabled: e.target.checked });
              playSound.pop();
            }}
          />
          <span className="custom-switch-track">
            <span className="custom-switch-thumb" />
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)' }}>
            {notif.enabled ? 'Notificaciones activadas en este dispositivo' : 'Notificaciones desactivadas en este dispositivo'}
          </span>
        </label>

        {notif.enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reminders.map((r) => {
              const on = notif[r.toggle];
              return (
                <div key={r.kind} style={box}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <label className="custom-switch">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          set({ [r.toggle]: e.target.checked });
                          playSound.pop();
                        }}
                      />
                      <span className="custom-switch-track">
                        <span className="custom-switch-thumb" />
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {r.icon}
                        {r.label}
                      </span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.time && (
                        <div style={{ width: 140 }}>
                          <CustomTimePicker
                            value={notif[r.time]}
                            onChange={(t) => set({ [r.time as TimeKey]: t })}
                            disabled={!on}
                            size="sm"
                            align="right"
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary sm"
                        onClick={() => void sendTest(r.kind)}
                        disabled={sending !== null || permission === 'unsupported'}
                        aria-label={`Probar: ${r.label}`}
                      >
                        <Send size={13} /> Probar
                      </button>
                    </div>
                  </div>
                  <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
                    {r.hint}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        <p className="hint" style={{ margin: 0 }}>
          Las notificaciones van directo al centro de actividades de Windows y a la bandeja del celular (Android / iOS). En Ajustes, las personas
          solo ven el interruptor para activarlas o apagarlas.
        </p>
      </div>
    </div>
  );
};
