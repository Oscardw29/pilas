import React, { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/ToastContext';
import { playSound } from '@/lib/sound';
import { createPost, getPostTemplates } from '@/social/api';
import { myUserId } from '@/social/runtime';
import { postText } from '@/social/texts';
import { useCatalogItem, useSocial } from '@/social/useSocial';
import type { Post, TemplateOption } from '@/social/types';
import { BanScreen } from './BanScreen';
import { POST_COMMENT_MAX as COMMENT_MAX, PostCard, useSocialFail } from './PostCard';
import './community.css';

const keyOf = (t: TemplateOption) => `${t.template}:${t.ref ?? ''}`;

/**
 * Publicar: solo las plantillas que el servidor dice que cumples ahora (available_post_templates).
 * Los datos los rellena el servidor y no se pueden editar; solo se añade un comentario opcional.
 */
export const PostModal: React.FC<{ isOpen: boolean; onClose: () => void; onPosted?: () => void }> = ({ isOpen, onClose, onPosted }) => {
  const { showToast } = useToast();
  const fail = useSocialFail();
  const profile = useSocial((s) => s.profile);
  const banned = useSocial((s) => Boolean(s.ban));
  const frame = useCatalogItem(profile?.frame_item);
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const commentId = useId();
  const groupName = useId();

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setTemplates(null);
    setLoadError(false);
    setSelected(null);
    setComment('');
    getPostTemplates()
      .then((rows) => {
        if (!active) return;
        const list = rows ?? [];
        setTemplates(list);
        setSelected(list[0] ? keyOf(list[0]) : null);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(true);
        fail(err, 'No se pudieron cargar las plantillas.');
      });
    return () => {
      active = false;
    };
  }, [isOpen, fail]);

  const chosen = templates?.find((t) => keyOf(t) === selected) ?? null;

  // Vista previa con tu foto, tu marco y tu nombre (el alias o, sin alias, el nombre)
  const preview: Post | null = useMemo(() => {
    if (!chosen || !profile) return null;
    return {
      id: 'preview',
      user_id: myUserId() ?? profile.user_id,
      alias: profile.alias,
      display_name: profile.display_name,
      avatar_path: profile.avatar_path,
      frame_path: frame?.asset_path ?? null,
      frame_thumb: frame?.thumb_path ?? null,
      frame_animated: frame?.animated ?? null,
      template: chosen.template,
      data: chosen.data ?? {},
      comment: comment.trim() || null,
      created_at: new Date().toISOString(),
      edited_at: null,
      reactions: { fire: 0, muscle: 0, clap: 0 },
      mine: [],
    };
  }, [chosen, profile, frame, comment]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen || sending || banned) return;
    setSending(true);
    try {
      await createPost(chosen.template, chosen.ref, comment.trim().slice(0, COMMENT_MAX) || null);
      playSound.pop();
      showToast('¡Publicado! Tus amigos lo verán en su inicio.', 'success');
      onPosted?.();
      onClose();
    } catch (err) {
      fail(err, 'No se pudo publicar.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Publicar" wide>
      {banned ? (
        <BanScreen compact />
      ) : !profile ? (
        <div className="empty" style={{ padding: '20px 8px' }}>
          <h3>Tu perfil público aún no está listo</h3>
          <p>Revisa tu perfil (nombre y, si quieres, un alias) para poder publicar y que tus amigos te encuentren.</p>
          <Link to="/perfil" className="btn btn-primary" onClick={onClose}>
            Ir a mi perfil
          </Link>
        </div>
      ) : (
        <form className="form" onSubmit={(e) => void submit(e)}>
          <p className="muted" style={{ fontSize: 13 }}>
            Las plantillas aparecen cuando cumples la condición; los datos se rellenan solos y no se pueden editar. Para usar un
            hábito, márcalo como visible en tu perfil.
          </p>

          {templates === null && !loadError ? (
            <div className="row" style={{ justifyContent: 'center', padding: 20 }} aria-live="polite">
              <span className="spinner" aria-hidden="true" /> <span className="muted">Buscando lo que puedes publicar…</span>
            </div>
          ) : loadError ? (
            <p className="form-error">No se pudieron cargar las plantillas. Cierra e inténtalo de nuevo.</p>
          ) : templates && templates.length === 0 ? (
            <div className="empty" style={{ padding: '16px 8px' }}>
              <h3>Todavía no hay nada que publicar</h3>
              <p>Sigue con tus hábitos: cuando tengas una racha, una semana perfecta, XP esta semana o un logro nuevo, aparecerá aquí.</p>
            </div>
          ) : (
            <fieldset className="tpl-options">
              <legend className="c-sr">Elige qué quieres publicar</legend>
              {templates!.map((t) => {
                const k = keyOf(t);
                const { icon, text } = postText(t.template, t.data ?? {});
                const on = k === selected;
                return (
                  <label key={k} className={`tpl-option ${on ? 'is-selected' : ''}`}>
                    <input type="radio" name={groupName} value={k} checked={on} onChange={() => setSelected(k)} />
                    <span className="post-icon" aria-hidden="true">
                      {icon}
                    </span>
                    <span className="tpl-text">{text}</span>
                    <span className="tpl-check" aria-hidden="true" />
                  </label>
                );
              })}
            </fieldset>
          )}

          {chosen && (
            <>
              <div className="field">
                <label className="label" htmlFor={commentId}>
                  Comentario (opcional)
                </label>
                <textarea
                  id={commentId}
                  className="textarea"
                  rows={3}
                  value={comment}
                  maxLength={COMMENT_MAX}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Cuéntales algo más"
                  aria-describedby={`${commentId}-count`}
                />
                <span id={`${commentId}-count`} className={`char-count ${comment.length > COMMENT_MAX - 20 ? 'is-near' : ''}`}>
                  {comment.length}/{COMMENT_MAX}
                </span>
              </div>

              {preview && (
                <div className="field">
                  <span className="label">Vista previa</span>
                  <PostCard post={preview} preview />
                </div>
              )}
            </>
          )}

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={!chosen || sending}>
              <Send aria-hidden="true" /> {sending ? 'Publicando…' : 'Publicar'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};
