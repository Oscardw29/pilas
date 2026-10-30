import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Search, Send, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/Avatar';
import { BanScreen } from '@/components/social/BanScreen';
import { CommunityUnavailable, PostCard, useSocialFail } from '@/components/social/PostCard';
import { PostModal } from '@/components/social/PostModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/ToastContext';
import { playSound } from '@/lib/sound';
import { getFeed, getMyFriends, removeFriend, respondFriendRequest, searchProfiles, sendFriendRequest, unblockUser } from '@/social/api';
import { myUserId } from '@/social/runtime';
import { useSocial } from '@/social/useSocial';
import type { MyFriends, Person, Post } from '@/social/types';
import '@/components/social/social.css';
import '@/components/social/community.css';

const PAGE = 20;
const EMPTY: MyFriends = { friends: [], incoming: [], outgoing: [], blocked: [] };

/** Fila de una persona: foto con marco, @alias (lleva a su perfil), una línea opcional y sus botones */
const PersonRow: React.FC<{ person: Person; sub?: React.ReactNode; children?: React.ReactNode }> = ({ person, sub, children }) => (
  <li className="person-row">
    <Link to={`/u/${person.alias}`} tabIndex={-1} aria-hidden="true" style={{ display: 'inline-grid' }}>
      <PersonAvatar person={person} size={40} />
    </Link>
    <div className="person-name">
      <Link to={`/u/${person.alias}`}>@{person.alias}</Link>
      {sub && <span>{sub}</span>}
    </div>
    {children && <div className="person-actions">{children}</div>}
  </li>
);

/**
 * AMIGOS (/amigos) — docs/plan-social.md, F6
 * Buscar por alias, responder solicitudes, la lista de amigos y bloqueados, y lo que publican tus amigos.
 */
export const FriendsView: React.FC = () => {
  const available = useSocial((s) => s.available);
  const phase = useSocial((s) => s.phase);
  const profile = useSocial((s) => s.profile);
  const banned = useSocial((s) => Boolean(s.ban));
  const { showToast } = useToast();
  const fail = useSocialFail();
  const searchId = useId();

  const [lists, setLists] = useState<MyFriends | null>(null);
  const [listsError, setListsError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Person | null>(null);

  const [q, setQ] = useState('');
  const [results, setResults] = useState<Person[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const [posts, setPosts] = useState<Post[]>([]);
  const [feedState, setFeedState] = useState<'loading' | 'idle' | 'more' | 'error'>('loading');
  const [hasMore, setHasMore] = useState(false);
  const [posting, setPosting] = useState(false);

  const enabled = available && Boolean(profile);

  const loadLists = useCallback(async () => {
    try {
      setLists((await getMyFriends()) ?? EMPTY);
      setListsError(false);
    } catch (err) {
      setListsError(true);
      fail(err, 'No se pudo cargar tu lista de amigos.');
    }
  }, [fail]);

  const loadFeed = useCallback(
    async (before?: string) => {
      setFeedState(before ? 'more' : 'loading');
      try {
        const rows = (await getFeed(null, before)) ?? [];
        setPosts((prev) => (before ? [...prev, ...rows.filter((r) => !prev.some((x) => x.id === r.id))] : rows));
        setHasMore(rows.length >= PAGE);
        setFeedState('idle');
      } catch (err) {
        setFeedState('error');
        fail(err, 'No se pudieron cargar las publicaciones.');
      }
    },
    [fail],
  );

  useEffect(() => {
    if (!enabled) return;
    void loadLists();
    void loadFeed();
  }, [enabled, loadLists, loadFeed]);

  // Búsqueda con espera de 300 ms; solo cuenta la última respuesta
  useEffect(() => {
    const term = q.trim();
    if (!enabled || term.replace(/^@/, '').length < 2) {
      searchSeq.current++;
      setResults(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(() => {
      searchProfiles(term.replace(/^@/, ''))
        .then((rows) => {
          if (seq === searchSeq.current) setResults(rows.filter((r) => r.user_id !== myUserId()));
        })
        .catch((err) => {
          if (seq === searchSeq.current) fail(err, 'No se pudo buscar.');
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [q, enabled, fail]);

  /** `fn` puede devolver otro texto de éxito (p. ej. si la solicitud quedó aceptada al momento) */
  const act = async (id: string, fn: () => Promise<unknown>, ok: string, fallback: string) => {
    setBusy(id);
    try {
      const msg = await fn();
      playSound.pop();
      showToast(typeof msg === 'string' ? msg : ok, 'success');
      await loadLists();
    } catch (err) {
      fail(err, fallback);
    } finally {
      setBusy(null);
    }
  };

  const add = (p: Person) =>
    act(
      p.user_id,
      async () => {
        const status = await sendFriendRequest(p.user_id);
        if (status !== 'accepted') return undefined;
        void loadFeed();
        return `¡Ahora eres amigo de @${p.alias}!`;
      },
      `Solicitud enviada a @${p.alias}`,
      'No se pudo enviar la solicitud.',
    );

  const respond = (p: Person, accept: boolean) =>
    act(
      p.user_id,
      async () => {
        await respondFriendRequest(p.user_id, accept);
        if (accept) void loadFeed();
      },
      accept ? `¡Ahora eres amigo de @${p.alias}!` : 'Solicitud rechazada',
      'No se pudo responder la solicitud.',
    );

  if (!available) {
    return (
      <div className="stack fade-up" style={{ maxWidth: 860 }}>
        <CommunityUnavailable />
      </div>
    );
  }

  const head = (
    <div className="page-head">
      <div>
        <p className="eyebrow">Comunidad</p>
        <h1>Amigos</h1>
      </div>
    </div>
  );

  if (!profile) {
    return (
      <div className="stack fade-up" style={{ maxWidth: 860 }}>
        {head}
        {phase === 'loading' ? (
          <div className="card row" style={{ justifyContent: 'center', padding: 32 }}>
            <span className="spinner" aria-hidden="true" /> <span className="muted">Cargando…</span>
          </div>
        ) : (
          <div className="card social-cta">
            <div className="empty-icon" style={{ margin: 0 }}>
              <Users aria-hidden="true" />
            </div>
            <div>
              <div className="card-title">Crea tu perfil público</div>
              <p className="card-sub" style={{ marginTop: 4 }}>
                Elige un alias para buscar amigos, enviar ánimos y compartir tus logros. Tus hábitos siguen siendo privados salvo los
                que marques como visibles.
              </p>
            </div>
            <Link to="/perfil" className="btn btn-primary">
              Ir a mi perfil
            </Link>
          </div>
        )}
      </div>
    );
  }

  const L = lists ?? EMPTY;
  const relation = (id: string) =>
    L.friends.some((f) => f.user_id === id)
      ? 'friend'
      : L.outgoing.some((f) => f.user_id === id)
        ? 'outgoing'
        : L.incoming.some((f) => f.user_id === id)
          ? 'incoming'
          : L.blocked.some((f) => f.user_id === id)
            ? 'blocked'
            : null;
  const writeOff = banned || busy !== null;
  const me = myUserId();

  return (
    <div className="stack fade-up" style={{ maxWidth: 860 }}>
      {head}
      {banned && <BanScreen compact />}

      {/* Buscar */}
      <section className="card" aria-label="Buscar personas">
        <label className="label" htmlFor={searchId} style={{ display: 'block', marginBottom: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>
          Buscar por alias
        </label>
        <div className="friends-search">
          <Search aria-hidden="true" />
          <input
            id={searchId}
            className="input"
            type="search"
            inputMode="search"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="@alias (mínimo 2 letras)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {(searching || results) && (
          <div style={{ marginTop: 12 }} aria-live="polite">
            {searching && !results ? (
              <div className="row muted" style={{ fontSize: 13 }}>
                <span className="spinner" aria-hidden="true" /> Buscando…
              </div>
            ) : results && results.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No hay nadie con ese alias.
              </p>
            ) : (
              <ul className="people-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {results?.map((r) => {
                  const rel = relation(r.user_id);
                  return (
                    <PersonRow key={r.user_id} person={r}>
                      {rel === 'friend' ? (
                        <span className="badge success">Amigo</span>
                      ) : rel === 'outgoing' ? (
                        <span className="badge">Enviada</span>
                      ) : rel === 'blocked' ? (
                        <span className="badge danger">Bloqueado</span>
                      ) : rel === 'incoming' ? (
                        <button type="button" className="btn btn-primary sm" disabled={writeOff} onClick={() => void respond(r, true)}>
                          <Check aria-hidden="true" /> Aceptar
                        </button>
                      ) : (
                        <button type="button" className="btn btn-primary sm" disabled={writeOff} onClick={() => void add(r)}>
                          <UserPlus aria-hidden="true" /> Añadir
                        </button>
                      )}
                    </PersonRow>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>

      {listsError && !lists ? (
        <div className="card">
          <p className="muted" style={{ fontSize: 13.5 }}>
            No se pudo cargar tu lista de amigos.
          </p>
          <button type="button" className="btn btn-secondary sm" style={{ marginTop: 10 }} onClick={() => void loadLists()}>
            Reintentar
          </button>
        </div>
      ) : !lists ? (
        <div className="card row" style={{ justifyContent: 'center', padding: 24 }}>
          <span className="spinner" aria-hidden="true" /> <span className="muted">Cargando amigos…</span>
        </div>
      ) : (
        <>
          {L.incoming.length > 0 && (
            <section className="card" aria-labelledby="fr-incoming">
              <h2 id="fr-incoming" className="section-title">
                Solicitudes recibidas <span className="notif-count">{L.incoming.length}</span>
              </h2>
              <ul className="people-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {L.incoming.map((f) => (
                  <PersonRow key={f.user_id} person={f} sub="Quiere ser tu amigo">
                    <button type="button" className="btn btn-primary sm" disabled={writeOff} onClick={() => void respond(f, true)}>
                      <Check aria-hidden="true" /> Aceptar
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm danger"
                      disabled={writeOff}
                      onClick={() => void respond(f, false)}
                      aria-label={`Rechazar la solicitud de @${f.alias}`}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </PersonRow>
                ))}
              </ul>
            </section>
          )}

          <section className="card" aria-labelledby="fr-friends">
            <h2 id="fr-friends" className="section-title">
              Tus amigos {L.friends.length > 0 && <span className="badge">{L.friends.length}</span>}
            </h2>
            {L.friends.length === 0 ? (
              <p className="muted" style={{ fontSize: 13.5 }}>
                Aún no tienes amigos aquí. Búscalos por su alias o toca a alguien en las clasificaciones para ver su perfil.
              </p>
            ) : (
              <ul className="people-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {L.friends.map((f) => (
                  <PersonRow
                    key={f.user_id}
                    person={f}
                    sub={
                      <>
                        <span aria-hidden="true">🔥</span> {f.streak ?? 0} {(f.streak ?? 0) === 1 ? 'día' : 'días'} de racha
                      </>
                    }
                  >
                    <button
                      type="button"
                      className="icon-btn sm danger"
                      disabled={busy !== null}
                      onClick={() => setRemoving(f)}
                      aria-label={`Eliminar a @${f.alias} de tus amigos`}
                      title="Eliminar amigo"
                    >
                      <UserMinus aria-hidden="true" />
                    </button>
                  </PersonRow>
                ))}
              </ul>
            )}
          </section>

          {L.outgoing.length > 0 && (
            <section className="card" aria-labelledby="fr-outgoing">
              <h2 id="fr-outgoing" className="section-title">
                Solicitudes enviadas
              </h2>
              <ul className="people-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {L.outgoing.map((f) => (
                  <PersonRow key={f.user_id} person={f} sub="Pendiente">
                    <button
                      type="button"
                      className="btn btn-ghost sm"
                      disabled={busy !== null}
                      onClick={() => void act(f.user_id, () => removeFriend(f.user_id), 'Solicitud cancelada', 'No se pudo cancelar la solicitud.')}
                    >
                      Cancelar
                    </button>
                  </PersonRow>
                ))}
              </ul>
            </section>
          )}

          {L.blocked.length > 0 && (
            <section className="card" aria-labelledby="fr-blocked">
              <h2 id="fr-blocked" className="section-title">
                Bloqueados
              </h2>
              <ul className="people-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {L.blocked.map((b) => (
                  <li key={b.user_id} className="person-row">
                    <div className="person-name">
                      <strong>{b.alias ? `@${b.alias}` : 'Perfil eliminado'}</strong>
                    </div>
                    <div className="person-actions">
                      <button
                        type="button"
                        className="btn btn-ghost sm"
                        disabled={busy !== null || !me}
                        onClick={() =>
                          me &&
                          void act(
                            b.user_id,
                            () => unblockUser(me, b.user_id),
                            b.alias ? `Desbloqueaste a @${b.alias}` : 'Desbloqueado',
                            'No se pudo desbloquear.',
                          )
                        }
                      >
                        Desbloquear
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Publicaciones de tus amigos (y las tuyas) */}
      <section className="card" aria-labelledby="fr-feed">
        <div className="card-head">
          <div>
            <h2 id="fr-feed" className="card-title">
              Publicaciones de tus amigos
            </h2>
            <div className="card-sub">Rachas, semanas perfectas y logros de tu gente</div>
          </div>
          <button type="button" className="btn btn-primary sm" onClick={() => setPosting(true)} disabled={banned}>
            <Send aria-hidden="true" /> Publicar
          </button>
        </div>
        {feedState === 'loading' ? (
          <div className="row" style={{ justifyContent: 'center', padding: 16 }}>
            <span className="spinner" aria-hidden="true" /> <span className="muted">Cargando…</span>
          </div>
        ) : posts.length === 0 ? (
          <p className="muted" style={{ fontSize: 13.5 }}>
            {feedState === 'error' ? 'No se pudieron cargar las publicaciones.' : 'Todavía no hay publicaciones. ¡Sé la primera persona en compartir algo!'}
          </p>
        ) : (
          <div className="post-list">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onDeleted={(id) => setPosts((list) => list.filter((x) => x.id !== id))} />
            ))}
          </div>
        )}
        {hasMore && posts.length > 0 && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-secondary sm"
              disabled={feedState === 'more'}
              onClick={() => void loadFeed(posts[posts.length - 1].created_at)}
            >
              {feedState === 'more' ? 'Cargando…' : 'Cargar más'}
            </button>
          </div>
        )}
      </section>

      <ConfirmModal
        isOpen={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const f = removing;
          if (f) void act(f.user_id, () => removeFriend(f.user_id), `@${f.alias} ya no está en tus amigos`, 'No se pudo eliminar la amistad.').then(() => loadFeed());
        }}
        title={removing ? `¿Eliminar a @${removing.alias} de tus amigos?` : 'Eliminar amigo'}
        message="Dejarás de ver sus publicaciones aquí. Podrás enviarle otra solicitud cuando quieras."
        confirmLabel="Eliminar"
        danger
      />
      <PostModal isOpen={posting} onClose={() => setPosting(false)} onPosted={() => void loadFeed()} />
    </div>
  );
};
