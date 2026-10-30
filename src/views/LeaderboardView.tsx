import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Coins, Flame, Shield, Timer, Trophy, Zap } from 'lucide-react';
import { PersonAvatar } from '@/components/profile/Avatar';
import { RankCard } from '@/components/social/Identity';
import { LoadError, ProfileCta, SocialUnavailable } from '@/components/social/SocialStates';
import { BanScreen } from '@/components/social/BanScreen';
import { Podium, fmtNum } from '@/components/social/Podium';
import { getLeaderboard, getLeagueStandings, getMyRank, socialAvailable } from '@/social/api';
import { useSocial } from '@/social/useSocial';
import { myUserId } from '@/social/runtime';
import { LEAGUES } from '@/social/texts';
import type { LeaderRow, LeaderboardKind, LeagueMember, LeagueStandings } from '@/social/types';
import '@/components/social/social.css';
import '@/components/social/leaderboard.css';

/**
 * CLASIFICACIONES (docs/plan-social.md, F5 y F5b)
 * Racha (permanente), XP (semana en curso o total, con el % de cumplimiento como desempate) y Mi liga.
 * Todo viene de las vistas y funciones públicas de 0002_social.sql: aquí solo se dibuja.
 */

type Tab = 'streak' | 'xp' | 'league';
const PAGE = 50;

const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : 'No se pudo cargar la información');
const pct = (c: number | null | undefined) => (c == null ? null : `${Math.round(Number(c) * 100)} %`);
const days = (n: number) => `${n} ${n === 1 ? 'día' : 'días'}`;

/* ---------------- Filas ---------------- */

const LeaderItem: React.FC<{ row: LeaderRow; kind: LeaderboardKind; me: string | null }> = ({ row, kind, me }) => {
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
        onClick={() => navigate(`/u/${row.alias}`)}
      >
        <span className={`lb-rank ${row.rank <= 3 ? `top-${row.rank}` : ''}`}>{row.rank}</span>
        <PersonAvatar person={row} size={36} />
        <span className="lb-name">
          <strong className="truncate">@{row.alias}</strong>
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

/* ---------------- Racha y XP ---------------- */

const EMPTY_TEXT: Record<LeaderboardKind, string> = {
  streak: 'Nadie tiene una racha activa todavía. Cumple tus hábitos hoy y estrena la tabla.',
  xp_week: 'Nadie ha ganado XP esta semana. ¡Sé quien abra la tabla!',
  xp_total: 'Nadie ha sumado XP todavía. Cumple tus hábitos y aparece aquí.',
};

const LeaderList: React.FC<{ kind: LeaderboardKind; hasProfile: boolean }> = ({ kind, hasProfile }) => {
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
        getLeaderboard(kind, 0, PAGE),
        me && hasProfile ? getMyRank(kind, me).catch(() => null) : Promise.resolve(null),
      ]);
      if (id !== reqId.current) return;
      setRows(page);
      setMine(myRow);
      setHasMore(page.length === PAGE);
    } catch (e) {
      if (id === reqId.current) setError(errMsg(e));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [kind, me, hasProfile]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    const id = reqId.current;
    setMore(true);
    setError(null);
    try {
      const page = await getLeaderboard(kind, rows.length, PAGE);
      if (id !== reqId.current) return;
      setRows((r) => [...r, ...page.filter((p) => !r.some((x) => x.user_id === p.user_id))]);
      setHasMore(page.length === PAGE);
    } catch (e) {
      if (id === reqId.current) setError(errMsg(e));
    } finally {
      if (id === reqId.current) setMore(false);
    }
  };

  if (loading) {
    return (
      <div className="lb-loading" role="status">
        <span className="spinner" aria-hidden="true" /> Cargando la clasificación…
      </div>
    );
  }
  if (error && rows.length === 0) return <LoadError message={error} onRetry={() => void load()} />;
  if (rows.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-icon">{kind === 'streak' ? <Flame aria-hidden="true" /> : <Zap aria-hidden="true" />}</div>
          <h3>Aún no hay nadie aquí</h3>
          <p>{EMPTY_TEXT[kind]}</p>
        </div>
      </div>
    );
  }

  const pinned = mine && !rows.some((r) => r.user_id === mine.user_id) ? mine : null;
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

const LeagueRow: React.FC<{ m: LeagueMember; pos: number | null; zone?: 'up' | 'down'; me: string | null }> = ({ m, pos, zone, me }) => {
  const navigate = useNavigate();
  const c = pct(m.completion);
  return (
    <li>
      <RankCard
        as="button"
        className={`lb-league-row ${zone ? `zone-${zone}` : ''} ${pos == null ? 'is-idle' : ''}`}
        card={m.card_path ? { path: m.card_path, thumb: m.card_thumb, animated: !!m.card_animated } : null}
        highlight={m.user_id === me}
        onClick={() => navigate(`/u/${m.alias}`)}
      >
        <span className="lb-rank">{pos ?? '—'}</span>
        <PersonAvatar person={m} size={36} />
        <span className="lb-name">
          <strong className="truncate">@{m.alias}</strong>
          {zone === 'up' && <span className="success">Zona de ascenso</span>}
          {zone === 'down' && <span className="danger">Zona de descenso</span>}
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
  if (!st) {
    return (
      <div className="lb-loading" role="status">
        <span className="spinner" aria-hidden="true" /> Cargando tu liga…
      </div>
    );
  }
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
  const up = st.promote ?? 0;
  const down = st.demote ?? 0;
  const zoneOf = (pos: number): 'up' | 'down' | undefined => (pos <= up ? 'up' : down > 0 && pos > n - down ? 'down' : undefined);
  const left = st.ends_at ? Date.parse(st.ends_at) - now : 0;
  const prizes = Array.isArray(st.prizes) && st.prizes.length >= 4 ? st.prizes : null;
  // Los % los fija el creador en la economía, y en Diamante no se sube ni en Bronce se baja: se cuenta lo que manda el servidor
  const lg = st.league ?? 1;
  const zonesText =
    n === 0
      ? ''
      : `${lg >= 5 ? 'En Diamante no se sube más' : `Ahora suben ${up === 1 ? 'el 1.º' : `los ${up} primeros`}`}${
          lg <= 1 ? ' y en Bronce nadie baja.' : down > 0 ? ` y bajan ${down === 1 ? 'el último' : `los ${down} últimos`}.` : ' y por ahora nadie baja.'
        }`;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card lb-league-head" style={{ '--lc': league.color } as React.CSSProperties} aria-label="Tu liga">
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
        {prizes && (
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
        <ol className="lb-list" aria-label={`Clasificación de la liga ${league.name}`}>
          {ranked.map((m, i) => (
            <LeagueRow key={m.user_id} m={m} pos={i + 1} zone={zoneOf(i + 1)} me={me} />
          ))}
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
        <span className="lb-legend up" aria-hidden="true" /> Ascenso <span className="lb-legend down" aria-hidden="true" /> Descenso ·{' '}
        {zonesText} Cierre: lunes 00:00 (hora de Colombia). Quien no gana XP en la semana no ocupa puesto ni recibe premio.
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
  // ?tab=liga|racha|xp: así el aviso del cierre semanal abre directamente «Mi liga»
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'liga' ? 'league' : params.get('tab') === 'racha' ? 'streak' : 'xp';
  const setTab = (t: Tab) => setParams(t === 'xp' ? {} : { tab: t === 'league' ? 'liga' : 'racha' }, { replace: true });
  const [range, setRange] = useState<'week' | 'total'>('week');
  const kind: LeaderboardKind = tab === 'streak' ? 'streak' : range === 'week' ? 'xp_week' : 'xp_total';

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

          <div className="lb-tabs">
            <div className="segmented" role="group" aria-label="Tipo de clasificación">
              {TABS.map((t) => (
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
        </>
      )}
    </div>
  );
};
