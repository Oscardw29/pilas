import React, { useEffect, useState } from 'react';
import { onSocialNotice } from '@/social/runtime';
import { getPeople } from '@/social/api';
import { notificationText } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { AchievementUnlockOverlay } from '@/components/ui/AchievementUnlockOverlay';
import { showSystemNotification } from '@/lib/notifications';
import { Modal } from '@/components/ui/Modal';
import { BanScreen } from './BanScreen';

/**
 * Avisos nuevos de la comunidad mientras la app está abierta:
 * - Un toast con el texto de la notificación (o una notificación del sistema si la ventana está oculta).
 * - Los logros nuevos NO lanzan ninguna animación sola: solo un aviso discreto y el contador de Notificaciones.
 *   La medalla sale una sola vez, al tocar su tarjeta en Logros (social/achievementSeen.ts).
 * - Un veto se muestra una vez por sesión con su motivo y su fecha de fin.
 * Aquí también se monta el overlay del logro (Shell monta los de racha y recompensa).
 */
export const SocialNotices: React.FC = () => {
  const { toast } = useToast();
  const ban = useSocial((s) => s.ban);
  const [banSeen, setBanSeen] = useState(false);

  useEffect(
    () =>
      onSocialNotice(async (n) => {
        if (n.actor_id && !n.actor) {
          n.actor = (await getPeople([n.actor_id]).catch(() => []))[0] ?? null;
        }
        const t = notificationText(n);
        const text = `${t.icon} ${t.actor ? `${t.actor} ` : ''}${t.text}`;
        const notifications = useStore.getState().settings.notifications;
        if (document.visibilityState === 'hidden' && notifications?.enabled) {
          void showSystemNotification({ title: '¡Pilas!', body: text, tag: `social-${n.id}` });
        } else if (n.kind === 'achievement') {
          toast(text, 'reward', 'Tu medalla te espera en Logros → Conseguidos');
        } else {
          toast(text, n.kind === 'warning' || n.kind === 'ban' ? 'warning' : 'info');
        }
      }),
    [toast],
  );

  return (
    <>
      <AchievementUnlockOverlay />
      <Modal isOpen={Boolean(ban) && !banSeen} onClose={() => setBanSeen(true)} title="Tu cuenta tiene un veto">
        <BanScreen />
      </Modal>
    </>
  );
};
