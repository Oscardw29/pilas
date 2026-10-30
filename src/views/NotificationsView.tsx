import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Award, Bell, Check, RefreshCw, Sparkles, X } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/Avatar';
import { CommunityUnavailable, useSocialFail } from '@/components/social/PostCard';
import { useToast } from '@/components/ui/ToastContext';
import { triggerAchievementCelebration } from '@/components/ui/AchievementUnlockOverlay';
import { playSound } from '@/lib/sound';
import { getMyFriends, getNotifications, markNotificationsRead, respondFriendRequest } from '@/social/api';
import { RARITY, notificationText, personName, timeAgo } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import type { NotificationRow, Rarity } from '@/social/types';
import '@/components/social/social.css';
import '@/components/social/community.css';

/**
 * NOTIFICACIONES (/notificaciones) — docs/plan-social.md, F6
 * Al abrirla se marcan como leídas; el punto de «sin leer» se mantiene en las que llegaron sin leer hasta salir.
 * Pulsar la notificación de un logro reproduce su animación (es el único sitio donde sale sola para la persona).
 */

/** Animación del logro de una notificación (los datos los puso el servidor al otorgarlo) */
function playAchievement(n: NotificationRow) {
  const d = n.data ?? {};
  const rarity = (typeof d.rarity === 'string' && d.rarity in RARITY ? d.rarity : 'common') as Rarity;
  triggerAchievementCelebration({
    name: String(d.name ?? 'Logro'),
    icon: String(d.icon ?? '🏅'),
    rarity,
    prize: Math.round(Number(d.prize) || 0),
  });
}
export const NotificationsView: React.FC = () => {
  const available = useSocial((s) => s.available);
  const banned = useSocial((s) => Boolean(s.ban));
  const navigate = useNavigate();
  const { showToast } = useToast();
  const fail = useSocialFail();

  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  // Solicitudes que siguen pendientes (las ya respondidas no muestran botones)
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [answered, setAnswered] = useState<Record<string, 'accepted' | 'rejected'>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, friends] = await Promise.all([getNotifications(), getMyFriends().catch(() => null)]);
      setRows(list);
      setPending(new Set((friends?.incoming ?? []).map((f) => f.user_id)));
      setError(false);
      if (list.some((n) => !n.read_at)) {
        await markNotificationsRead().catch(() => undefined);
      }
      useSocial.getState().set({ unread: 0 });
    } catch (err) {
      setError(true);
      fail(err, 'No se pudieron cargar las notificaciones.');
    } finally {
      setLoading(false);
    }
  }, [fail]);

  useEffect(() => {
    if (available) void load();
  }, [available, load]);

  const respond = async (n: NotificationRow, accept: boolean) => {
    if (!n.actor_id) return;
    const id = n.actor_id;
    setBusy(id);
    try {
      await respondFriendRequest(id, accept);
      playSound.pop();
      showToast(accept ? `¡Ahora eres amigo de ${n.actor ? personName(n.actor) : 'esa persona'}!` : 'Solicitud rechazada', 'success');
      setAnswered((a) => ({ ...a, [id]: accept ? 'accepted' : 'rejected' }));
      setPending((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    } catch (err) {
      fail(err, 'No se pudo responder la solicitud.');
    } finally {
      setBusy(null);
    }
  };

  if (!available) {
    return (
      <div className="stack fade-up" style={{ maxWidth: 760 }}>
        <CommunityUnavailable />
      </div>
    );
  }

  return (
    <div className="stack fade-up" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Comunidad</p>
          <h1>Notificaciones</h1>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-ghost sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw aria-hidden="true" /> Actualizar
          </button>
        </div>
      </div>

      {rows === null ? (
        error ? (
          <div className="card empty">
            <h3>No se pudieron cargar las notificaciones</h3>
            <p>Revisa tu conexión e inténtalo de nuevo.</p>
            <button type="button" className="btn btn-secondary" onClick={() => void load()}>
              Reintentar
            </button>
          </div>
        ) : (
          <div className="card row" style={{ justifyContent: 'center', padding: 32 }} aria-live="polite">
            <span className="spinner" aria-hidden="true" /> <span className="muted">Cargando…</span>
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon">
            <Bell aria-hidden="true" />
          </div>
          <h3>No tienes notificaciones</h3>
          <p>Aquí verás las solicitudes de amistad, los ánimos de tus amigos, tus logros y los resultados de tu liga.</p>
        </div>
      ) : (
        <section className="card flush" aria-label="Tus notificaciones">
          <ul className="notif-list">
            {rows.map((n) => {
              const t = notificationText(n);
              const unread = !n.read_at;
              const isAchievement = n.kind === 'achievement';
              const Main = t.to || isAchievement ? 'button' : 'div';
              const showActions = n.kind === 'friend_request' && n.actor_id && (pending.has(n.actor_id) || answered[n.actor_id]);
              return (
                <li key={n.id} className={`notif-row ${unread ? 'is-unread' : ''}`}>
                  <Main
                    className="notif-main"
                    {...(isAchievement
                      ? { type: 'button' as const, onClick: () => playAchievement(n), title: 'Ver la animación del logro' }
                      : t.to
                        ? { type: 'button' as const, onClick: () => navigate(t.to!) }
                        : {})}
                  >
                    {n.actor ? (
                      <PersonAvatar person={n.actor} size={40} />
                    ) : (
                      <span className="notif-icon" aria-hidden="true">
                        {t.icon}
                      </span>
                    )}
                    <span className="notif-text">
                      {n.actor && (
                        <span aria-hidden="true" style={{ marginRight: 4 }}>
                          {t.icon}
                        </span>
                      )}
                      {t.actor && <strong>{t.actor}</strong>} {t.text}
                      <time dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
                      {isAchievement && (
                        <span className="badge accent notif-play" style={{ marginTop: 6 }}>
                          <Sparkles aria-hidden="true" /> Toca para ver tu medalla
                        </span>
                      )}
                    </span>
                    {unread && (
                      <span className="notif-unread" role="img" aria-label="Sin leer" />
                    )}
                  </Main>
                  {isAchievement && (
                    <div className="notif-actions">
                      <button type="button" className="btn btn-ghost sm" onClick={() => navigate('/logros')}>
                        <Award aria-hidden="true" /> Ver en Logros
                      </button>
                    </div>
                  )}
                  {showActions && n.actor_id && (
                    <div className="notif-actions">
                      {answered[n.actor_id] ? (
                        <span className={`badge ${answered[n.actor_id] === 'accepted' ? 'success' : ''}`}>
                          {answered[n.actor_id] === 'accepted' ? 'Aceptada' : 'Rechazada'}
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary sm"
                            disabled={banned || busy !== null}
                            onClick={() => void respond(n, true)}
                          >
                            <Check aria-hidden="true" /> Aceptar
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost sm"
                            disabled={banned || busy !== null}
                            onClick={() => void respond(n, false)}
                          >
                            <X aria-hidden="true" /> Rechazar
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
};
