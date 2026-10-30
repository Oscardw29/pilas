import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Coins, Eye, Flame, Shield, Timer, Trophy, Zap } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/Avatar';
import { RankCard } from '@/components/social/Identity';
import { LoadError, ProfileCta, SocialUnavailable } from '@/components/social/SocialStates';
import { BanScreen } from '@/components/social/BanScreen';
import { Podium, PodiumStage, fmtNum } from '@/components/social/Podium';
import { getLeaderboard, getLeagueStandings, getMyRank, socialAvailable } from '@/social/api';
import { useSocial } from '@/social/useSocial';
import { useInView } from '@/social/useInView';
import { myUserId } from '@/social/runtime';
import { LEAGUES, personName, profilePath } from '@/social/texts';
import { useDemoMode, useStore } from '@/store/useStore';
import type { LeaderRow, LeaderboardKind, LeagueMember, LeagueStandings } from '@/social/types';
import '@/components/social/social.css';
import '@/components/social/leaderboard.css';

/**
 * CLASIFICACIONES (docs/plan-social.md, F5 y F5b)
 * Racha (permanente), XP (semana en curso o total, con el % de cumplimiento como desempate) y Mi liga.
 * En escritorio ancho la racha es una tarjeta fija a la derecha (podio + lista con su propio scroll) y la columna
 * principal queda para la XP y la liga; en pantallas más estrechas cada tabla es una pestaña.
 * Todo viene de las vistas y funciones públicas de 0002_social.sql: aquí solo se dibuja.
 */

type Tab = 'streak' | 'xp' | 'league';
const PAGE = 50;
/** Tarjeta de racha: hasta el 10.º de entrada y luego de 20 en 20 */
const STREAK_FIRST = 10;
const STREAK_PAGE = 20;
/** Desde este ancho la racha va en la tarjeta lateral */
const WIDE_QUERY = '(min-width: 1180px)';

const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'No se pudo cargar la información');
const pct = (c: number | null | undefined) => (c == null ? null : `${Math.round(Number(c) * 100)} %`);
const days = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/* ---------------- Datos de una tabla ---------------- */

/** Carga una clasificación por páginas y el puesto propio (si no aparece en lo cargado se muestra aparte) */
function useLeaderboard(kind: LeaderboardKind, hasProfile: boolean, first = PAGE, next = PAGE) {
  const me = myUserId();
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [mine, setMine] = useState<LeaderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Evita que una respuesta vieja (de otra pestaña) pise la actual
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    setRows([]);
    setMine(null);
    try {
      const [page, myRow] = await Promise.all([
        getLeaderboard(kind, 0, first),
        me && hasProfile ? getMyRank(kind, me).catch(() => null) : Promise.resolve(null),
      ]);
      if (id !== reqId.current) return;
      setRows(page);
      setMine(myRow);
      setHasMore(page.length === first);
    } catch (e) {
      if (id === reqId.current) setError(errMsg(e));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [kind, me, hasProfile, first]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    const id = reqId.current;
    setMore(true);
    setError(null);
    try {
      const page = await getLeaderboard(kind, rows.length, next);
      if (id !== reqId.current) return;
      setRows((r) => [...r, ...page.filter((p) => !r.some((x) => x.user_id === p.user_id))]);
      setHasMore(page.length === next);
    } catch (e) {
      if (id === reqId.current) setError(errMsg(e));
    } finally {
      if (id === reqId.current) setMore(false);
    }
  };

  const pinned = mine && !rows.some((r) => r.user_id === mine.user_id) ? mine : null;
  return { me, rows, pinned, loading, more, hasMore, error, load, loadMore };
}

/* ---------------- Filas ---------------- */

const LeaderItem: React.FC<{ row: LeaderRow; kind: LeaderboardKind; me: string | null; compact?: boolean }> = ({ row, kind, me, compact }) => {
  const navigate = useNavigate();
  const isMe = row.user_id === me;
  const xp = Number(row.xp ?? 0);
  const c = pct(row.completion);
  return (
    <li>
      <RankCard
        as="button"
        card={row.card_path ? { path: row.card_path, thumb: row.card_thumb, animated: !!row.card_animated } : null}
        highlight={isMe}
        onClick={() => navigate(profilePath(row))}
      >
        <span className={`lb-rank ${row.rank <= 3 ? `top-${row.rank}` : ''}`}>{row.rank}</span>
        <PersonAvatar person={row} size={compact ? 30 : 36} />
        <span className="lb-name">
          <strong className="truncate">{personName(row)}</strong>
          {isMe && <span>Tú</span>}
        </span>
        {kind === 'streak' ? (
          <span className="lb-metric">
            <strong>🔥 {days(Number(row.current_streak ?? 0))}</strong>
            <span>récord {Number(row.best_streak ?? 0)}</span>
          </span>
        ) : (
          <span className="lb-metric">
            <strong>{fmtNum(xp)} XP</strong>
            {c && <span title={kind === 'xp_week' ? 'Cumplimiento de esta semana' : 'Cumplimiento de los últimos 30 días'}>{c} cumplido</span>}
          </span>
        )}
      </RankCard>
    </li>
  );
};

const Loading: React.FC<{ text: string }> = ({ text }) => (
  <div className="lb-loading" role="status">
    <span className="spinner" aria-hidden="true" /> {text}
  </div>
);

/* ---------------- Racha y XP (lista de la columna principal) ---------------- */

const EMPTY_TEXT: Record<LeaderboardKind, string> = {
  streak: 'Nadie tiene una racha activa todavía. Cumple tus hábitos hoy y estrena la tabla.',
  xp_week: 'Nadie ha ganado XP esta semana. ¡Sé quien abra la tabla!',
  xp_total: 'Nadie ha sumado XP todavía. Cumple tus hábitos y aparece aquí.',
};

const EmptyBoard: React.FC<{ kind: LeaderboardKind; flat?: boolean }> = ({ kind, flat }) => {
  const body = (
    <div className="empty">
      <div className="empty-icon">{kind === 'streak' ? <Flame aria-hidden="true" /> : <Zap aria-hidden="true" />}</div>
      <h3>Aún no hay nadie aquí</h3>
      <p>{EMPTY_TEXT[kind]}</p>
    </div>
  );
  return flat ? body : <div className="card">{body}</div>;
};

const LeaderList: React.FC<{ kind: LeaderboardKind; hasProfile: boolean }> = ({ kind, hasProfile }) => {
  const { me, rows, pinned, loading, more, hasMore, error, load, loadMore } = useLeaderboard(kind, hasProfile);

  if (loading) return <Loading text="Cargando la clasificación…" />;
  if (error && rows.length === 0) return <LoadError message={error} onRetry={() => void load()} />;
  if (rows.length === 0) return <EmptyBoard kind={kind} />;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <ol className="lb-list" aria-label="Clasificación">
        {rows.map((r) => (
          <LeaderItem key={r.user_id} row={r} kind={kind} me={me} />
        ))}
      </ol>
      {error && <LoadError message={error} onRetry={() => void loadMore()} />}
      {hasMore && !error && (
        <button type="button" className="btn btn-secondary lb-more" onClick={() => void loadMore()} disabled={more}>
          {more ? 'Cargando…' : 'Cargar más'}
        </button>
      )}
      {pinned && (
        <div className="lb-pinned">
          <p className="eyebrow">Tu puesto</p>
          <ol className="lb-list" aria-label="Tu puesto">
            <LeaderItem row={pinned} kind={kind} me={me} />
          </ol>
        </div>
      )}
    </div>
  );
};

/* ---------------- Tarjeta fija de racha (escritorio ancho) ---------------- */

/**
 * Podio de 3 arriba y debajo la lista hasta el 10.º. «Ver más» carga más dentro de la misma tarjeta:
 * la tarjeta no crece (su lista tiene alto fijo y su propio scroll) y queda pegada al hacer scroll en la página.
 */
const StreakCard: React.FC<{ hasProfile: boolean }> = ({ hasProfile }) => {
  const ref = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { me, rows, pinned, loading, more, hasMore, error, load, loadMore } = useLeaderboard('streak', hasProfile, STREAK_FIRST, STREAK_PAGE);
  const inView = useInView(ref, rows.length > 0);
  const top = rows.slice(0, 3).map((r) => ({ ...r, value: days(Number(r.current_streak ?? 0)) }));
  const rest = rows.slice(3);

  const showMore = async () => {
    const before = listRef.current?.scrollHeight ?? 0;
    await loadMore();
    // Asoma lo recién cargado dentro de la misma tarjeta (la tarjeta no crece: se desplaza su lista)
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el || el.scrollHeight <= before) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ top: el.scrollTop + el.clientHeight * 0.6, behavior: reduce ? 'auto' : 'smooth' });
    });
  };

  return (
    <aside ref={ref} className="card lb-streak-card" aria-label="Clasificación de racha">
      <div className="lb-streak-head">
        <span className="lb-streak-icon" aria-hidden="true">
          <Flame size={18} />
        </span>
        <div>
          <h2 className="card-title">Racha</h2>
          <p className="card-sub">Racha actual · si hay empate, gana el récord</p>
        </div>
      </div>

      {loading ? (
        <Loading text="Cargando la racha…" />
      ) : error && rows.length === 0 ? (
        <LoadError message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <EmptyBoard kind="streak" flat />
      ) : (
        <>
          <PodiumStage entries={top} inView={inView} compact />
          <div ref={listRef} className="lb-streak-scroll" role="region" aria-label="Más puestos de la racha" tabIndex={rest.length > 6 ? 0 : undefined}>
            {rest.length > 0 && (
              <ol className="lb-list is-compact" aria-label="Clasificación de racha, del 4.º en adelante">
                {rest.map((r) => (
                  <LeaderItem key={r.user_id} row={r} kind="streak" me={me} compact />
                ))}
              </ol>
            )}
            {error && <LoadError message={error} onRetry={() => void showMore()} />}
            {hasMore && !error && (
              <button type="button" className="btn btn-ghost sm lb-more" onClick={() => void showMore()} disabled={more}>
                {more ? 'Cargando…' : 'Ver más'}
              </button>
            )}
          </div>
          {pinned && (
            <div className="lb-streak-mine">
              <p className="eyebrow">Tu puesto</p>
              <ol className="lb-list is-compact" aria-label="Tu puesto en racha">
                <LeaderItem row={pinned} kind="streak" me={me} compact />
              </ol>
            </div>
          )}
        </>
      )}
    </aside>
  );
};

/* ---------------- Mi liga ---------------- */

/** «3 d 4 h», «5 h 12 min», «8 min» */
function countdown(ms: number): string {
  if (ms <= 0) return 'cerrando…';
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${Math.max(1, m)} min`;
}

function useNow(every = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [every]);
  return now;
}

const PRIZE_LABELS = ['1.º', '2.º', '3.º', '4.º–10.º'];

/** up: sube · mid: zona intermedia (se queda) · down: baja · solo: punto medio (menos de 2 clasificados) */
type Zone = 'up' | 'mid' | 'down' | 'solo';

/** Solo se rotulan las filas que cambian de liga; la zona intermedia y el punto medio van sin rótulo */
const ZONE_TEXT: Partial<Record<Zone, { text: string; cls: string }>> = {
  up: { text: 'Zona de ascenso', cls: 'success' },
  down: { text: 'Zona de descenso', cls: 'danger' },
};

const LeagueRow: React.FC<{ m: LeagueMember; pos: number | null; zone?: Zone; me: string | null }> = ({ m, pos, zone, me }) => {
  const navigate = useNavigate();
  const c = pct(m.completion);
  return (
    <li>
      <RankCard
        as="button"
        className={`lb-league-row ${zone ? `zone-${zone}` : ''} ${pos == null ? 'is-idle' : ''}`}
        card={m.card_path ? { path: m.card_path, thumb: m.card_thumb, animated: !!m.card_animated } : null}
        highlight={m.user_id === me}
        onClick={() => navigate(profilePath(m))}
      >
        <span className="lb-rank">{pos ?? '—'}</span>
        <PersonAvatar person={m} size={36} />
        <span className="lb-name">
          <strong className="truncate">{personName(m)}</strong>
          {zone && ZONE_TEXT[zone] && <span className={ZONE_TEXT[zone]!.cls}>{ZONE_TEXT[zone]!.text}</span>}
          {pos == null && <span>Sin XP esta semana</span>}
        </span>
        {pos != null && (
          <span className="lb-metric">
            <strong>{fmtNum(Number(m.xp))} XP</strong>
            {c && <span title="Cumplimiento de esta semana">{c} cumplido</span>}
          </span>
        )}
      </RankCard>
    </li>
  );
};

/** Línea entre dos zonas (decorativa: la zona de cada fila ya se lee en su texto) */
const ZoneLine: React.FC<{ kind: 'up' | 'down' }> = ({ kind }) => (
  <li className={`lb-zone-line ${kind}`} aria-hidden="true">
    <span>{kind === 'up' ? '▲ Zona de ascenso' : '▼ Zona de descenso'}</span>
  </li>
);

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('#', String(n)));

const LeagueTab: React.FC<{ hasProfile: boolean }> = ({ hasProfile }) => {
  const me = myUserId();
  const now = useNow();
  const [st, setSt] = useState<LeagueStandings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setSt(null);
    try {
      setSt(await getLeagueStandings());
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <LoadError message={error} onRetry={() => void load()} />;
  if (!st) return <Loading text="Cargando tu liga…" />;
  if (!st.member) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-icon">
            <Shield aria-hidden="true" />
          </div>
          <h3>Todavía no estás en una liga</h3>
          <p>
            Entras a una liga cuando ganas XP con tu perfil público. Empiezas en Bronce y cada semana compites con personas de tu
            nivel por monedas y por subir de liga.
          </p>
          {!hasProfile && (
            <Link to="/perfil" className="btn btn-primary sm">
              Crear mi perfil público
            </Link>
          )}
        </div>
      </div>
    );
  }

  const league = LEAGUES.find((l) => l.id === st.league) ?? LEAGUES[0];
  const members = st.members ?? [];
  const ranked = members.filter((m) => Number(m.xp) > 0);
  const idle = members.filter((m) => !(Number(m.xp) > 0));
  const n = ranked.length;
  // Con menos de 2 personas clasificadas nadie sube ni baja: punto medio y premio de participación
  const solo = Boolean(st.solo) || n < 2;
  const soloPrize = Math.round(Number(st.solo_prize ?? 25));
  const meRanked = ranked.some((m) => m.user_id === me);
  // Los cupos los calcula el servidor: los primeros `promote` suben, los `stay` siguientes se quedan y el resto
  // (`demote`) baja. Se ajustan a los clasificados que se ven; `demote: 0` (Bronce) manda sobre «el resto baja»
  const clampN = (v: unknown, max: number) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
  const up = solo ? 0 : clampN(st.promote, n);
  const noDemote = solo || (st.demote != null && !(Number(st.demote) > 0));
  const stay = solo || noDemote ? n - up : st.stay != null ? clampN(st.stay, n - up) : n - up - clampN(st.demote, n - up);
  const down = n - up - stay;
  // Primer puesto que baja
  const downFrom = down > 0 ? up + stay + 1 : n + 1;
  const zoneOf = (pos: number): Zone => (solo ? 'solo' : pos <= up ? 'up' : pos >= downFrom ? 'down' : 'mid');
  const left = st.ends_at ? Date.parse(st.ends_at) - now : 0;
  const prizes = Array.isArray(st.prizes) && st.prizes.length >= 4 ? st.prizes : null;
  const lg = st.league ?? 1;

  // Reglas de esta semana con los cupos que manda el servidor (en Diamante no se sube y en Bronce no se baja)
  const rules = solo
    ? `En tu grupo hay menos de 2 personas clasificadas: esta semana nadie sube ni baja y ${meRanked ? 'ganas' : 'quien está clasificado gana'} ${soloPrize} monedas por participar.`
    : [
        up > 0 ? `Suben ${plural(up, 'el 1.º', 'los # primeros')}` : lg >= 5 ? 'En Diamante no se sube más' : 'Por ahora nadie sube',
        stay > 0
          ? up > 0
            ? `se ${plural(stay, 'queda el siguiente', 'quedan los # siguientes')}`
            : `se ${plural(stay, 'queda el 1.º', 'quedan los # primeros')}`
          : null,
        down > 0 ? `bajan ${plural(down, 'el último', 'los # últimos')}` : lg <= 1 ? 'en Bronce nadie baja' : 'por ahora nadie baja',
      ]
        .filter(Boolean)
        .join(', ')
        .replace(/, ([^,]*)$/, ' y $1') + '.';

  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card lb-league-head" style={{ '--lc': league.color, '--lc-text': league.text } as React.CSSProperties} aria-label="Tu liga">
        <span className="lb-league-icon" aria-hidden="true">
          {league.icon}
        </span>
        <div className="lb-league-title">
          <h2>Liga {st.league_name || league.name}</h2>
          <p className="card-sub">
            Grupo {st.group ?? 1} · {n} {n === 1 ? 'persona compite' : 'personas compiten'}
          </p>
        </div>
        {st.ends_at && (
          <span className="badge accent lb-countdown" aria-live="polite">
            <Timer aria-hidden="true" /> Cierra en {countdown(left)}
          </span>
        )}
        {solo ? (
          <div className="lb-solo" role="note">
            <span className="lb-solo-mark" aria-hidden="true">
              ⚖️
            </span>
            <div>
              <strong>{meRanked ? 'Estás en un punto medio' : 'Tu grupo está en un punto medio'}</strong>
              <p>
                Con menos de 2 personas clasificadas no hay ascenso ni descenso esta semana: quien gane XP se lleva solo el premio por
                participar.
              </p>
            </div>
            <span className="lb-solo-prize">
              <span>
                <Coins aria-hidden="true" /> {fmtNum(soloPrize)}
              </span>
              <small>monedas por participar</small>
            </span>
          </div>
        ) : (
          prizes && (
            <ul className="lb-prizes" aria-label="Premios en monedas">
              {prizes.slice(0, 4).map((p, i) => (
                <li key={PRIZE_LABELS[i]}>
                  <span>{PRIZE_LABELS[i]}</span>
                  <strong>
                    <Coins aria-hidden="true" /> {fmtNum(Number(p))}
                  </strong>
                </li>
              ))}
            </ul>
          )
        )}
      </section>

      {n === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="empty-icon">
              <Zap aria-hidden="true" />
            </div>
            <h3>Nadie ha ganado XP esta semana</h3>
            <p>Cumple tus hábitos para tomar la delantera en tu grupo.</p>
          </div>
        </div>
      ) : (
        <ol className="lb-list lb-league-list" aria-label={`Clasificación de la liga ${league.name}`}>
          {ranked.map((m, i) => {
            const pos = i + 1;
            return (
              <React.Fragment key={m.user_id}>
                <LeagueRow m={m} pos={pos} zone={zoneOf(pos)} me={me} />
                {/* Verde entre el último que sube y el primero que no; roja entre el último que se queda y el primero que baja */}
                {!solo && pos === up && pos < n && <ZoneLine kind="up" />}
                {!solo && pos === downFrom - 1 && pos < n && <ZoneLine kind="down" />}
              </React.Fragment>
            );
          })}
        </ol>
      )}

      {idle.length > 0 && (
        <div className="lb-pinned">
          <p className="eyebrow">Sin XP esta semana ({idle.length})</p>
          <ul className="lb-list" aria-label="Personas sin XP esta semana">
            {idle.map((m) => (
              <LeagueRow key={m.user_id} m={m} pos={null} me={me} />
            ))}
          </ul>
        </div>
      )}

      <p className="lb-note">
        {!solo && (
          <>
            <span className="lb-legend up" aria-hidden="true" /> Ascenso <span className="lb-legend down" aria-hidden="true" /> Descenso ·{' '}
          </>
        )}
        {n > 0 && `${rules} `}Cierre: lunes 00:00 (hora de Colombia). Quien no gana XP en la semana no ocupa puesto ni recibe premio.
      </p>
    </div>
  );
};

/* ---------------- Página ---------------- */

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'streak', label: 'Racha', icon: <Flame size={15} aria-hidden="true" /> },
  { id: 'xp', label: 'XP', icon: <Zap size={15} aria-hidden="true" /> },
  { id: 'league', label: 'Mi liga', icon: <Shield size={15} aria-hidden="true" /> },
];

export const LeaderboardView: React.FC = () => {
  const available = useSocial((s) => s.available);
  const profile = useSocial((s) => s.profile);
  const ban = useSocial((s) => s.ban);
  const demo = useDemoMode();
  const wide = useMediaQuery(WIDE_QUERY);
  // ?tab=liga|racha|xp: así el aviso del cierre semanal abre directamente «Mi liga»
  const [params, setParams] = useSearchParams();
  const asked: Tab = params.get('tab') === 'liga' ? 'league' : params.get('tab') === 'racha' ? 'streak' : 'xp';
  // En escritorio ancho la racha ya está a la vista en su tarjeta: la columna principal muestra la XP
  const tab: Tab = wide && asked === 'streak' ? 'xp' : asked;
  const setTab = (t: Tab) => setParams(t === 'xp' ? {} : { tab: t === 'league' ? 'liga' : 'racha' }, { replace: true });
  const [range, setRange] = useState<'week' | 'total'>('week');
  const kind: LeaderboardKind = tab === 'streak' ? 'streak' : range === 'week' ? 'xp_week' : 'xp_total';
  const tabs = wide ? TABS.filter((t) => t.id !== 'streak') : TABS;

  return (
    <div className="stack fade-up lb-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Comunidad</p>
          <h1>Clasificaciones</h1>
        </div>
      </div>

      {!available || !socialAvailable() ? (
        <SocialUnavailable what="Las clasificaciones" />
      ) : (
        <>
          {ban && <BanScreen compact />}
          {!profile && !ban && (
            <ProfileCta text="Para aparecer en las tablas y competir en las ligas necesitas un perfil público. Mientras tanto puedes mirar las clasificaciones." />
          )}
          {demo && (
            <div className="callout lb-demo-note" role="note">
              <Eye aria-hidden="true" />
              <p>
                <strong>Modo demostración:</strong> tus cifras no se publican. Las tablas muestran lo que hay en el servidor; tus datos de
                demostración no aparecen en ellas ni cuentan para tu liga.
              </p>
            </div>
          )}

          <div className={`lb-layout ${wide ? 'is-wide' : ''}`}>
            <div className="lb-main stack">
              <div className="lb-tabs">
                <div className="segmented" role="group" aria-label="Tipo de clasificación">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={tab === t.id ? 'active' : ''}
                      aria-pressed={tab === t.id}
                      onClick={() => setTab(t.id)}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
                {tab === 'xp' && (
                  <div className="segmented" role="group" aria-label="Periodo de la XP">
                    {(
                      [
                        ['week', 'Esta semana'],
                        ['total', 'Total'],
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} type="button" className={range === id ? 'active' : ''} aria-pressed={range === id} onClick={() => setRange(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {tab === 'streak' && (
                <p className="lb-hint">
                  <Flame size={14} aria-hidden="true" /> Ordenada por la racha actual. Si hay empate, gana el récord más largo.
                </p>
              )}
              {tab === 'xp' && (
                <p className="lb-hint">
                  <Trophy size={14} aria-hidden="true" />
                  {range === 'week'
                    ? ' XP desde el lunes (hora de Colombia). Si hay empate, gana el mayor % de cumplimiento.'
                    : ' XP de siempre. Si hay empate, gana el mayor % de cumplimiento de los últimos 30 días.'}
                </p>
              )}

              {tab === 'xp' && range === 'week' && <Podium />}
              {tab === 'league' ? <LeagueTab hasProfile={!!profile} /> : <LeaderList key={kind} kind={kind} hasProfile={!!profile} />}
            </div>

            {wide && <StreakCard hasProfile={!!profile} />}
          </div>
        </>
      )}
    </div>
  );
};
