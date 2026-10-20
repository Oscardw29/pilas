import type { Habit } from '@/types';
import { useStore } from '@/store/useStore';
import { isScheduled, getLog, isDoneLog, calculateGlobalStreak } from '@/lib/metrics';
import { todayKey } from '@/lib/dates';
import { getCoachPersona } from '@/components/coach/coachPersona';

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

export type NotificationType = 'habit' | 'streak' | 'coach' | 'morning' | 'midday' | 'night';

// Clave en localStorage para recordar notificaciones ya enviadas hoy
const SENT_STORAGE_KEY = 'constancia_sent_notifications_v1';

// Control de rotación de variantes para alternar frases dinámicamente
let variantRotationCounter = 0;

function pickVariant<T>(list: T[]): T {
  if (list.length === 0) throw new Error('List cannot be empty');
  // Combina número aleatorio y rotador para máxima variedad
  const index = (Math.floor(Math.random() * list.length) + variantRotationCounter++) % list.length;
  return list[index];
}

/* =========================================================================
   1. REGISTRO DE SERVICE WORKER Y PERMISOS DEL SISTEMA
   ========================================================================= */

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await registerServiceWorker();
    }
    return perm;
  } catch (err) {
    console.error('Error solicitando permisos de notificación:', err);
    return Notification.permission;
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch (err) {
    console.warn('Registro de Service Worker no disponible o falló:', err);
    return null;
  }
}

/* =========================================================================
   2. ENVÍO NATIVO AL SISTEMA OPERATIVO (WINDOWS & CELULARES)
   ========================================================================= */

export async function showSystemNotification(payload: NotificationPayload): Promise<boolean> {
  if (!isNotificationSupported()) {
    console.warn('[Pilas] Las notificaciones no están soportadas en este navegador.');
    return false;
  }

  if (Notification.permission !== 'granted') {
    console.warn('[Pilas] Permiso de notificaciones no concedido:', Notification.permission);
    return false;
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const icon = payload.icon || (origin ? `${origin}/icon-192.png` : '/icon-192.png');
  const badge = payload.badge || (origin ? `${origin}/icon-192.png` : '/icon-192.png');
  const tag = payload.tag || `constancia-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  let displayed = false;

  // 1. En entornos de escritorio (Windows / macOS / Linux), 'new Notification' se entrega al instante (0ms).
  // renotify: true asegura que Windows active el banner emergente de inmediato incluso con notificaciones consecutivas.
  try {
    const notifOptions: any = {
      body: payload.body,
      icon,
      badge,
      tag,
      renotify: true,
      requireInteraction: false,
      silent: false,
    };
    const notif = new Notification(payload.title, notifOptions);
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
    displayed = true;
  } catch {
    // Si 'new Notification' no es permitido (ej. en navegadores móviles Android que exigen Service Worker), continuar abajo
  }

  // 2. Fallback con Service Worker (esencial para celulares Android/iOS y cuando el navegador lo exige)
  if (!displayed && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      // getRegistration no se queda esperando si no hay Service Worker activo (ready sí)
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(payload.title, {
          body: payload.body,
          icon,
          badge,
          tag,
          renotify: true,
          requireInteraction: false,
          silent: false,
          data: { url: origin || '/', ...(payload.data || {}) },
          vibrate: [200, 100, 200],
        } as NotificationOptions);
        displayed = true;
      }
    } catch (swErr) {
      console.warn('[Pilas] Service Worker showNotification advertencia:', swErr);
    }
  }

  return displayed;
}

/* =========================================================================
   3. VARIANTES DE MENSAJES (HÁBITOS, RACHA, COACH IA Y RUTINAS)
   ========================================================================= */

export function getHabitVariants(habit: Habit, userName: string): { title: string; body: string }[] {
  const name = habit.name;
  const icon = habit.icon || '🎯';
  const user = userName.trim() || 'Campeón';
  const timeHint = habit.targetMinutes ? `${habit.targetMinutes} min` : 'unos minutos';

  return [
    {
      title: `${icon} ¡Hora de tu hábito: ${name}!`,
      body: `${user}, es tu momento del día para avanzar. Dedica ${timeHint} para mantener tu disciplina al máximo.`,
    },
    {
      title: `🔔 Recordatorio: ${icon} ${name}`,
      body: `¡Toca cumplir hoy! Incluso la versión mínima (🌱) mantendrá encendida tu constancia.`,
    },
    {
      title: `🎯 Tu objetivo de hoy: ${name}`,
      body: `${user}, cada día completado construye la persona que quieres ser. ¡Manos a la obra!`,
    },
    {
      title: `⚡ Tiempo de enfoque: ${icon} ${name}`,
      body: `Unos minutos de dedicación consciente marcarán una gran diferencia en tus resultados.`,
    },
    {
      title: `🌱 Paso a paso con ${name} ${icon}`,
      body: `${user}, recuerda por qué empezaste. Da el primer paso ahora mismo y marca el check.`,
    },
    {
      title: `🔥 No rompas la cadena: ${name}`,
      body: `Tu esfuerzo de los días anteriores merece que cumplas hoy también. ¡A por ello!`,
    },
  ];
}

export function getStreakVariants(userName: string, pendingCount: number, currentStreak: number): { title: string; body: string }[] {
  const user = userName.trim() || 'Campeón';
  const pendingText = pendingCount > 1 ? `${pendingCount} hábitos pendientes` : '1 hábito pendiente';
  const streakText = currentStreak > 0 ? `de ${currentStreak} días` : 'activa';

  return [
    {
      title: `🔥 ¡Protege tu racha activa, ${user}!`,
      body: `Aún tienes ${pendingText} hoy. No permitas que el día termine sin asegurar tu fuego.`,
    },
    {
      title: `⚠️ ¡Alerta de racha! No la dejes caer`,
      body: `${user}, el día está avanzando. Cumple con tus hábitos o activa el modo mínimo para no romper la cadena.`,
    },
    {
      title: `🔥 Mantén viva tu racha ${streakText}`,
      body: `Recuerda: incluso completar la versión mínima (🌱) salva tu racha antes de que llegue la medianoche.`,
    },
    {
      title: `🛡️ ¡Defiende tu constancia acumulada!`,
      body: `${user}, cada día sumado es una victoria para tu disciplina. Abre la app y asegura tu día.`,
    },
    {
      title: `⏳ Queda poco tiempo: ¡salva tu racha!`,
      body: `Solo necesitas unos minutos antes de terminar la jornada para que tu esfuerzo no se pierda.`,
    },
    {
      title: `🔥 Tu esfuerzo merece continuar, ${user}`,
      body: `No te acuestes sin marcar tus hábitos de hoy. Tu racha y tus puntos te están esperando.`,
    },
  ];
}

export function getCoachVariants(userName: string): { title: string; body: string }[] {
  const user = userName.trim() || 'Campeón';
  const coach = getCoachPersona().name;

  return [
    {
      title: `📣 ${coach}: Mensaje para ti, ${user}`,
      body: `«La disciplina es el puente entre tus metas y tus logros. Respira hondo y continúa con determinación.»`,
    },
    {
      title: `💬 ${coach}: Tu dosis de claridad, ${user}`,
      body: `«No busques la perfección, busca la constancia. Lo que haces hoy en silencio hablará mañana.»`,
    },
    {
      title: `✨ ${coach}: ¡Vamos con todo, ${user}!`,
      body: `«He estado observando tu proceso. Cada pequeño esfuerzo que realizas hoy te acerca a tu mejor versión.»`,
    },
    {
      title: `🎯 ${coach}: Enfoque y prioridades`,
      body: `${user}, pregúntate: ¿qué acción de 10 minutos puedes hacer ahora mismo que te haga sentir orgulloso al terminar el día?`,
    },
    {
      title: `🧠 ${coach}: Pausa estratégica para ${user}`,
      body: `«Tómate 30 segundos, desconecta de las distracciones y reconecta con tus metas de hoy. Tú tienes el control.»`,
    },
    {
      title: `💪 ${coach}: Cree en tu constancia, ${user}`,
      body: `«Incluso en los días con menos energía, dar el paso mínimo construye una mentalidad imparable. ¡Sigue firme!»`,
    },
    {
      title: `⚡ ${coach}: El poder de los hábitos`,
      body: `${user}, los resultados extraordinarios provienen de acciones ordinarias repetidas con paciencia cada día.`,
    },
  ];
}

export function getMorningVariants(userName: string): { title: string; body: string }[] {
  const user = userName.trim() || 'Campeón';

  return [
    {
      title: `☀️ ¡Buenos días, ${user}!`,
      body: `Un nuevo día para ganar. Revisa tus hábitos programados de hoy y empieza con el pie derecho.`,
    },
    {
      title: `🌅 Arranca tu día con energía, ${user}`,
      body: `Cumplir tu primer hábito temprano marcará un ritmo ganador para toda la jornada.`,
    },
    {
      title: `✨ Tu jornada comienza hoy`,
      body: `${user}, visualiza tus metas y da el primer paso antes del mediodía. ¡El día es tuyo!`,
    },
    {
      title: `☕ A por todas hoy, ${user}`,
      body: `La constancia no es suerte, es una decisión que tomas cada mañana. ¡Haz que este día cuente!`,
    },
  ];
}

export function getMiddayVariants(userName: string): { title: string; body: string }[] {
  const user = userName.trim() || 'Campeón';

  return [
    {
      title: `💧 Pausa de bienestar, ${user}`,
      body: `Recuerda hidratarte, estirar el cuerpo y revisar cómo va tu nivel de energía esta tarde.`,
    },
    {
      title: `🔋 Recarga de mitad de jornada`,
      body: `${user}, una pausa de 5 minutos y un vaso de agua renovarán tu enfoque para la tarde.`,
    },
    {
      title: `🧘 Check-in de energía para ${user}`,
      body: `Respira hondo, corrige tu postura en la silla y celebra los primeros avances de tu mañana.`,
    },
    {
      title: `⚡ Momento de reiniciar foco`,
      body: `${user}, tómate un respiro antes de continuar con tus actividades clave de la tarde.`,
    },
  ];
}

export function getNightVariants(userName: string): { title: string; body: string }[] {
  const user = userName.trim() || 'Campeón';

  return [
    {
      title: `🌙 Cierre del día, ${user}`,
      body: `Gran trabajo hoy. Haz balance de tus logros, relájate y prepárate para un descanso reparador.`,
    },
    {
      title: `🛌 Hora de desconectar y descansar`,
      body: `${user}, el descanso de calidad es la base de tu rendimiento de mañana. Apaga pantallas y buenas noches.`,
    },
    {
      title: `✨ Balance nocturno, ${user}`,
      body: `Cada día que cumples con tu disciplina es un día ganado para tu futuro. ¡Que descanses de lo mejor!`,
    },
    {
      title: `⭐ Tu descanso es sagrado`,
      body: `${user}, desconecta tu mente de las obligaciones. Mañana será otro gran día para seguir creciendo.`,
    },
  ];
}

/* =========================================================================
   4. CONTROL DE HISTORIAL Y ENVÍO DIARIO (PREVENIR DUPLICADOS)
   ========================================================================= */

function getSentMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function hasNotificationBeenSentToday(key: string): boolean {
  const map = getSentMap();
  const fullKey = `${todayKey()}|${key}`;
  return !!map[fullKey];
}

function markNotificationAsSentToday(key: string): void {
  try {
    const map = getSentMap();
    const today = todayKey();
    const fullKey = `${today}|${key}`;
    map[fullKey] = true;

    // Limpiar claves viejas de días anteriores
    const cleaned: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(map)) {
      if (k.startsWith(today)) {
        cleaned[k] = v;
      }
    }
    localStorage.setItem(SENT_STORAGE_KEY, JSON.stringify(cleaned));
  } catch (err) {
    console.error('Error guardando registro de notificación:', err);
  }
}

function unmarkNotificationSentToday(key: string): void {
  try {
    const map = getSentMap();
    delete map[`${todayKey()}|${key}`];
    localStorage.setItem(SENT_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

/* =========================================================================
   5. MOTOR DE CHEQUEO AUTOMÁTICO (SCHEDULER LOOP)
   ========================================================================= */

/**
 * Margen para enviar un recordatorio que no se pudo enviar a su hora exacta
 * (pestaña en segundo plano con temporizadores ralentizados, equipo suspendido, app abierta más tarde...).
 */
const CATCH_UP_MINUTES = 30;

const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** ¿Ya llegó la hora del recordatorio y seguimos dentro del margen de recuperación? */
function isDue(time: string, now: Date): boolean {
  const target = toMinutes(time);
  if (target == null) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= target && current - target <= CATCH_UP_MINUTES;
}

/**
 * Reserva el envío ANTES de esperar al sistema: dos chequeos solapados (StrictMode, intervalos)
 * no pueden enviar el mismo recordatorio dos veces. Si el envío falla se libera la reserva.
 */
async function sendOnce(key: string, payload: NotificationPayload): Promise<void> {
  if (hasNotificationBeenSentToday(key)) return;
  markNotificationAsSentToday(key);
  const sent = await showSystemNotification(payload);
  if (!sent) unmarkNotificationSentToday(key);
}

let checkInProgress = false;

export async function runNotificationCheck(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (getNotificationPermission() !== 'granted') return;
  if (checkInProgress) return;
  checkInProgress = true;
  try {
    await checkReminders(new Date());
  } catch (err) {
    console.warn('[Pilas] Error al comprobar recordatorios:', err);
  } finally {
    checkInProgress = false;
  }
}

async function checkReminders(now: Date): Promise<void> {
  const state = useStore.getState();
  const settings = state.settings;
  const config = settings.notifications;

  // Si las notificaciones globales están desactivadas
  if (config && config.enabled === false) return;

  const today = todayKey();
  const userName = settings.userName || 'Usuario';

  // A. Hábitos programados a su hora (solo si aún no se completaron hoy)
  if (!config || config.habitReminders !== false) {
    for (const h of state.habits || []) {
      if (h.status !== 'active' || !isScheduled(h, today)) continue;
      if (!h.reminderTime || !isDue(h.reminderTime, now)) continue;
      if (isDoneLog(getLog(state, h.id, today))) continue;
      const variant = pickVariant(getHabitVariants(h, userName));
      await sendOnce(`habit_${h.id}`, { title: variant.title, body: variant.body, tag: `habit-${h.id}-${today}` });
    }
  }

  // B. Recordatorio para salvar la racha activa
  if ((!config || config.streakReminder !== false) && isDue(config?.streakReminderTime || '20:30', now)) {
    const pendingHabits = (state.habits || []).filter(
      (h) => h.status === 'active' && isScheduled(h, today) && !isDoneLog(getLog(state, h.id, today))
    );
    if (pendingHabits.length > 0) {
      const curStreak = calculateGlobalStreak(state, today).streak;
      const variant = pickVariant(getStreakVariants(userName, pendingHabits.length, curStreak));
      await sendOnce('streak_reminder', { title: variant.title, body: variant.body, tag: `streak-${today}` });
    }
  }

  // C-F. Recordatorios generales del día
  const general: { enabled: boolean | undefined; time: string; key: string; tag: string; variants: () => { title: string; body: string }[] }[] = [
    { enabled: config?.coachReminder, time: config?.coachReminderTime || '16:30', key: 'coach_reminder', tag: 'coach', variants: () => getCoachVariants(userName) },
    { enabled: config?.morningReminder, time: config?.morningReminderTime || '08:00', key: 'morning_reminder', tag: 'morning', variants: () => getMorningVariants(userName) },
    { enabled: config?.middayReminder, time: config?.middayReminderTime || '13:30', key: 'midday_reminder', tag: 'midday', variants: () => getMiddayVariants(userName) },
    { enabled: config?.nightReminder, time: config?.nightReminderTime || '22:00', key: 'night_reminder', tag: 'night', variants: () => getNightVariants(userName) },
  ];
  for (const r of general) {
    if (r.enabled === false || !isDue(r.time, now)) continue;
    const variant = pickVariant(r.variants());
    await sendOnce(r.key, { title: variant.title, body: variant.body, tag: `${r.tag}-${today}` });
  }
}

/* =========================================================================
   6. DISPARADORES DE PRUEBA INMEDIATA (PARA WINDOWS Y CELULARES)
   ========================================================================= */

export async function triggerTestNotification(
  type: NotificationType,
  userName: string,
  sampleHabit?: Habit
): Promise<{ success: boolean; message: string }> {
  let perm = getNotificationPermission();
  if (perm !== 'granted') {
    perm = await requestNotificationPermission();
    if (perm !== 'granted') {
      return {
        success: false,
        message: 'Debes conceder permisos de notificación en el navegador para que aparezcan en el sistema operativo.',
      };
    }
  }

  let variant: { title: string; body: string };

  switch (type) {
    case 'habit': {
      const fallbackHabit: Habit = sampleHabit || {
        id: 'test-habit',
        name: 'Hacer ejercicio matutino',
        icon: '🏃',
        color: '#34d399',
        days: [0, 1, 2, 3, 4, 5, 6],
        points: 20,
        priority: 3,
        preferredTime: 'morning',
        reminderTime: '08:00',
        goals: [],
        createdAt: todayKey(),
        status: 'active',
        targetMinutes: 30,
      };
      variant = pickVariant(getHabitVariants(fallbackHabit, userName));
      break;
    }
    case 'streak': {
      variant = pickVariant(getStreakVariants(userName, 2, 5));
      break;
    }
    case 'coach': {
      variant = pickVariant(getCoachVariants(userName));
      break;
    }
    case 'morning': {
      variant = pickVariant(getMorningVariants(userName));
      break;
    }
    case 'midday': {
      variant = pickVariant(getMiddayVariants(userName));
      break;
    }
    case 'night': {
      variant = pickVariant(getNightVariants(userName));
      break;
    }
    default:
      variant = {
        title: '🔔 Notificación de prueba de ¡Pilas!',
        body: `${userName || 'Usuario'}, las notificaciones del sistema están funcionando correctamente en tu equipo.`,
      };
  }

  const ok = await showSystemNotification({
    title: variant.title,
    body: variant.body,
    tag: `test-${type}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
  });

  return {
    success: ok,
    message: ok
      ? `Notificación de prueba enviada al sistema con éxito (${type}).`
      : 'No se pudo enviar la notificación al sistema.',
  };
}
