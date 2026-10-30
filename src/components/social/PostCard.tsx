import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { CloudOff, Flag, MoreHorizontal, Trash2 } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/Avatar';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/ToastContext';
import { playSound } from '@/lib/sound';
import { deletePost, setReaction, SocialError } from '@/social/api';
import { myUserId, refreshSocialStatus } from '@/social/runtime';
import { postText, REACTIONS, timeAgo } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import type { Post, ReactionEmoji } from '@/social/types';
import { ReasonModal, ReportModal } from './ReportModal';
import './social.css';
import './community.css';

/* ---------------- Piezas comunes de la comunidad ---------------- */

/** Muestra el error del servidor en un toast; si la cuenta tiene un veto, vuelve a pedir el estado para enseñarlo */
export function useSocialFail() {
  const { showToast } = useToast();
  return useCallback(
    (err: unknown, fallback = 'No se pudo completar la acción. Inténtalo de nuevo.') => {
      if (err instanceof SocialError) {
        showToast(err.message, 'error');
        if (err.banned) void refreshSocialStatus();
      } else {
        showToast(fallback, 'error');
      }
      playSound.error();
    },
    [showToast],
  );
}

/** El servidor aún no tiene la migración 0002: lo social se queda en pausa sin romper nada */
export const CommunityUnavailable: React.FC = () => (
  <div className="card empty">
    <div className="empty-icon">
      <CloudOff aria-hidden="true" />
    </div>
    <h3>La comunidad todavía no está lista</h3>
    <p>
      El servidor aún necesita la capa de comunidad (migración 0002). Tus hábitos y todo lo privado siguen funcionando con
      normalidad.
    </p>
  </div>
);

export interface MoreMenuItem {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Botón «⋯» con su menú (portal con posición fija: ninguna tarjeta lo recorta) */
export const MoreMenu: React.FC<{ items: MoreMenuItem[]; label?: string; className?: string }> = ({
  items,
  label = 'Más opciones',
  className = 'icon-btn sm',
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((focusButton = false) => {
    setOpen(false);
    if (focusButton) btnRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = menuRef.current?.offsetWidth ?? 200;
    const height = menuRef.current?.offsetHeight ?? 100;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const below = r.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 6) : below;
    setPos({ top, left });
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    const onScroll = () => close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close]);

  if (!items.length) return null;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="more-menu"
            role="menu"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          >
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={`more-menu-item ${it.danger ? 'danger' : ''}`}
                disabled={it.disabled}
                onClick={() => {
                  close();
                  it.onSelect();
                }}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

/* ---------------- Publicación ---------------- */

/**
 * Una publicación hecha desde plantilla: el texto lo pone el servidor (no se puede editar) y debajo va el comentario opcional.
 * Reacciones 🔥 💪 👏 con actualización optimista. `preview` dibuja la vista previa del modal (sin acciones).
 */
export const PostCard: React.FC<{ post: Post; onDeleted?: (id: string) => void; preview?: boolean }> = ({ post, onDeleted, preview }) => {
  const isAdmin = useSocial((s) => s.isAdmin);
  const banned = useSocial((s) => Boolean(s.ban));
  const { showToast } = useToast();
  const fail = useSocialFail();
  const me = myUserId();
  const isMine = Boolean(me && post.user_id === me);

  const [counts, setCounts] = useState(post.reactions);
  const [mine, setMine] = useState<ReactionEmoji[]>(post.mine ?? []);
  const pending = useRef(new Set<ReactionEmoji>());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adminDelete, setAdminDelete] = useState(false);
  const [reporting, setReporting] = useState(false);

  // Si llega una versión nueva de la publicación (recarga), se usa la del servidor
  useEffect(() => {
    setCounts(post.reactions);
    setMine(post.mine ?? []);
  }, [post]);

  const { icon, text } = postText(post.template, post.data ?? {});

  const toggle = async (emoji: ReactionEmoji) => {
    if (!me || preview || pending.current.has(emoji)) return;
    const on = !mine.includes(emoji);
    const apply = (add: boolean) => {
      setMine((m) => (add ? [...m.filter((e) => e !== emoji), emoji] : m.filter((e) => e !== emoji)));
      setCounts((c) => ({ ...c, [emoji]: Math.max(0, (c[emoji] ?? 0) + (add ? 1 : -1)) }));
    };
    apply(on);
    if (on) playSound.pop();
    pending.current.add(emoji);
    try {
      await setReaction(post.id, me, emoji, on);
    } catch (err) {
      apply(!on);
      fail(err, 'No se pudo guardar tu reacción.');
    } finally {
      pending.current.delete(emoji);
    }
  };

  const remove = async (asAdmin: boolean, reason = '') => {
    try {
      await deletePost(post.id, asAdmin, reason);
      playSound.delete();
      showToast('Publicación borrada', 'success');
      onDeleted?.(post.id);
    } catch (err) {
      fail(err, 'No se pudo borrar la publicación.');
      throw err;
    }
  };

  const items: MoreMenuItem[] = [];
  if (!preview) {
    if (isMine) {
      items.push({ label: 'Borrar', icon: <Trash2 aria-hidden="true" />, danger: true, onSelect: () => setConfirmDelete(true) });
    } else {
      if (isAdmin) items.push({ label: 'Borrar (moderación)', icon: <Trash2 aria-hidden="true" />, danger: true, onSelect: () => setAdminDelete(true) });
      items.push({ label: 'Reportar', icon: <Flag aria-hidden="true" />, onSelect: () => setReporting(true), disabled: banned });
    }
  }

  const when = preview ? 'ahora' : timeAgo(post.created_at);
  const profileTo = `/u/${post.alias}`;

  return (
    <article className={`post-card ${preview ? 'is-preview' : ''}`} aria-label={`Publicación de @${post.alias}`}>
      <header className="post-head">
        {preview ? (
          <PersonAvatar person={post} size={40} />
        ) : (
          <Link to={profileTo} aria-label={`Ver el perfil de @${post.alias}`} tabIndex={-1}>
            <PersonAvatar person={post} size={40} />
          </Link>
        )}
        <div className="post-who">
          {preview ? <strong>@{post.alias}</strong> : <Link to={profileTo}>@{post.alias}</Link>}
          {preview ? <span className="muted" style={{ fontSize: 12 }}>{when}</span> : <time dateTime={post.created_at}>{when}</time>}
        </div>
        <MoreMenu items={items} label="Opciones de la publicación" />
      </header>

      <div className="post-body">
        <span className="post-icon" aria-hidden="true">
          {icon}
        </span>
        <p className="post-text">{text}</p>
      </div>
      {post.comment && <p className="post-comment">{post.comment}</p>}

      <div className="post-reactions" role="group" aria-label="Reacciones">
        {REACTIONS.map((r) => {
          const pressed = mine.includes(r.id);
          const n = counts?.[r.id] ?? 0;
          return (
            <button
              key={r.id}
              type="button"
              className="reaction-btn"
              aria-pressed={pressed}
              aria-label={`${r.label}: ${n}`}
              disabled={preview || banned || !me}
              onClick={() => void toggle(r.id)}
            >
              <span className="emoji" aria-hidden="true">
                {r.emoji}
              </span>
              <span className="count" aria-hidden="true">
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {!preview && (
        <>
          <ConfirmModal
            isOpen={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            onConfirm={() => void remove(false).catch(() => undefined)}
            title="¿Borrar la publicación?"
            message="Se quita para siempre junto con sus reacciones."
            confirmLabel="Borrar"
            danger
          />
          <ReasonModal
            isOpen={adminDelete}
            onClose={() => setAdminDelete(false)}
            title="Borrar publicación"
            description={`La publicación de @${post.alias} se borrará y la acción quedará en el registro de moderación.`}
            confirmLabel="Borrar"
            danger
            onSubmit={(reason) => remove(true, reason)}
          />
          <ReportModal isOpen={reporting} onClose={() => setReporting(false)} targetUser={post.user_id} alias={post.alias} postId={post.id} />
        </>
      )}
    </article>
  );
};
