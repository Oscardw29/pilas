import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onSocialNotice } from '@/social/runtime';
import { getPeople } from '@/social/api';
import { notificationText } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { triggerRewardCelebration } from '@/components/ui/RewardCelebrationOverlay';
import { showSystemNotification } from '@/lib/notifications';
import { Modal } from '@/components/ui/Modal';
import { BanScreen } from './BanScreen';

/**
 * Avisos nuevos de la comunidad mientras la app está abierta:
 * - Un toast con el texto de la notificación (o una notificación del sistema si la ventana está oculta).
 * - Los logros nuevos lanzan una celebración, de una en una (cola de la F2).
 * - Un veto se muestra una vez por sesión con su motivo y su fecha de fin.
 */
export const SocialNotices: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
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
        if (n.kind === 'achievement') {
          triggerRewardCelebration({
            name: String(n.data.name ?? 'Logro'),
            icon: String(n.data.icon ?? '🏅'),
            kicker: '¡Logro desbloqueado!',
            subtitle: Number(n.data.prize) > 0 ? `Te llevas ${Number(n.data.prize)} monedas de premio.` : 'Ya aparece en tu página de logros.',
          });
        }
        const notifications = useStore.getState().settings.notifications;
        if (document.visibilityState === 'hidden' && notifications?.enabled) {
          void showSystemNotification({ title: '¡Pilas!', body: text, tag: `social-${n.id}` });
        } else if (n.kind !== 'achievement') {
          toast(text, n.kind === 'warning' || n.kind === 'ban' ? 'warning' : 'info');
        }
      }),
    [toast, navigate],
  );

  return (
    <Modal isOpen={Boolean(ban) && !banSeen} onClose={() => setBanSeen(true)} title="Tu cuenta tiene un veto">
      <BanScreen />
    </Modal>
  );
};
