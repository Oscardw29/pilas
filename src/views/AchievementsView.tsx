import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, CheckCircle2, Coins, Eye, Lock, Users } from 'lucide-react';
import { BanScreen } from '@/components/social/BanScreen';
import { getAchievementDefs, getAchievementProgress, getAchievementRates, getUserAchievements, socialAvailable } from '@/social/api';
import { useSocial } from '@/social/useSocial';
import { myUserId } from '@/social/runtime';
import { localPreviewStats, type LocalPreviewStats } from '@/social/publish';
import { METRIC_LABEL, RARITY } from '@/social/texts';
import type { AchievementDef, AchievementMetric } from '@/social/types';
import { useDemoMode, useStore } from '@/store/useStore';
import { todayKey } from '@/lib/dates';
import { LoadError, ProfileCta, SocialUnavailable } from '@/components/social/SocialStates';
import '@/components/social/social.css';
import '@/components/social/leaderboard.css';

/**
 * LOGROS (docs/plan-social.md, F5b)
 * Los otorga el servidor (check_achievements) a partir de los datos públicos: aquí solo se muestran con su progreso,
 * la fecha en que se consiguieron y el % de personas que los tienen.
 * Modo demostración (nada se publica): las métricas que se pueden calcular en el dispositivo (racha, XP total,
 * hábitos cumplidos, monedas gastadas y semanas perfectas) muestran el progreso de los datos de demostración y
 * cuentan como conseguidas al llegar a la meta. Es solo una vista previa: el servidor no se entera.
 */

type Filter = 'all' | 'done' | 'pending';

/** Métricas que se calculan en el dispositivo en modo demostración (mismas reglas que el servidor) */
const LOCAL_METRIC: Partial<Record<AchievementMetric, (s: LocalPreviewStats) => number>> = {
  streak: (s) => s.bestStreak,
  xp_total: (s) => s.xpTotal,
  habits_done: (s) => s.habitsDone,
  coins_spent: (s) => s.coinsSpent,
  perfect_weeks: (s) => s.perfectWeeks,
};

/** Cifras locales con los datos de demostración (se recalculan cuando cambian) */
function useDemoStats(): LocalPreviewStats | null {
  const demo = useDemoMode();
  const habits = useStore((s) => s.habits);
  const logs = useStore((s) => s.logs);
  const redemptions = useStore((s) => s.redemptions);
  const pointEvents = useStore((s) => s.pointEvents);
  const streakFreezes = useStore((s) => s.streakFreezes);
  const xpBoosts = useStore((s) => s.xpBoosts);
  return useMemo(
    () => (demo ? localPreviewStats(useStore.getState(), todayKey()) : null),
    // Los datos se leen del store al recalcular; estas dependencias solo dicen cuándo
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demo, habits, logs, redemptions, pointEvents, streakFreezes, xpBoosts],
  );
}

interface Data {
  defs: AchievementDef[];
  earned: Map<string, string>;
  rates: Map<string, number>;
  progress: Record<string, number> | null;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtPct = (n: number) => n.toLocaleString('es', { maximumFractionDigits: n < 10 ? 1 : 0 });

const AchievementCard: React.FC<{ def: AchievementDef; at?: string; rate?: number; value: number | null; demoGot?: boolean }> = ({
  def,
  at,
  rate,
  value,
  demoGot,
}) => {
  const rarity = RARITY[def.rarity] ?? RARITY.common;
  const got = Boolean(at) || Boolean(demoGot);
  const target = Math.max(1, Number(def.threshold) || 1);
  const shown = got ? target : Math.min(target, Math.max(0, Math.floor(value ?? 0)));
  const metric = METRIC_LABEL[def.metric] ?? def.metric;
  return (
    <article
      className={`card ach-card ${got ? 'is-done' : 'is-locked'}`}
      style={{ '--r': rarity.color, '--r-text': rarity.text } as React.CSSProperties}
      aria-label={`${def.name}${got ? ', conseguido' : ', pendiente'}`}
    >
      <div className="ach-top">
        <span className="ach-icon" aria-hidden="true">
          {def.icon || '🏅'}
          {!got && (
            <span className="ach-lock">
              <Lock size={12} />
            </span>
          )}
        </span>
        <div className="ach-text">
          <h3>{def.name}</h3>
          <p>{def.description}</p>
        </div>
      </div>

      <div className="ach-badges">
        <span className="rarity">{rarity.label}</span>
        {def.prize > 0 && (
          <span className="badge warning">
            <Coins aria-hidden="true" /> +{def.prize} monedas
          </span>
        )}
      </div>

      {(got || value != null) && (
        <div className="ach-progress" title={`${shown} de ${target} ${metric}`}>
          <div
            className="progress thin"
            role="progressbar"
            aria-label={`Progreso: ${shown} de ${target} ${metric}`}
            aria-valuemin={0}
            aria-valuemax={target}
            aria-valuenow={shown}
            style={{ '--c': got ? 'var(--success)' : rarity.color } as React.CSSProperties}
          >
            <div style={{ width: `${(shown / target) * 100}%` }} />
          </div>
          <span className="ach-count">
            {shown}/{target}
          </span>
        </div>
      )}

      <div className="ach-foot">
        {got && at ? (
          <span className="success">
            <CheckCircle2 size={14} aria-hidden="true" /> Conseguido el {fmtDate(at)}
          </span>
        ) : got ? (
          <span className="ach-demo-tag">
            <Eye aria-hidden="true" /> Conseguido con los datos de demostración
          </span>
        ) : (
          value == null && <span className="muted">Meta: {target} {metric}</span>
        )}
        {rate != null && (
          <span className="muted">
            <Users size={13} aria-hidden="true" /> {rate > 0 ? `El ${fmtPct(rate)} % de las personas lo tiene` : 'Aún nadie lo tiene'}
          </span>
        )}
      </div>
    </article>
  );
};

export const AchievementsView: React.FC = () => {
  const available = useSocial((s) => s.available);
  const profile = useSocial((s) => s.profile);
  const ban = useSocial((s) => s.ban);
  const hasProfile = Boolean(profile);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const ready = available && socialAvailable();
  const demoStats = useDemoStats();

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    const me = myUserId();
    try {
      const [defs, mine, rates, progress] = await Promise.all([
        getAchievementDefs(),
        me ? getUserAchievements(me) : Promise.resolve([]),
        getAchievementRates().catch(() => new Map<string, number>()),
        hasProfile ? getAchievementProgress().catch(() => null) : Promise.resolve(null),
      ]);
      const earned = new Map(mine.map((a) => [a.achievement_id, a.achieved_at]));
      setData({
        // Los retirados ya no se pueden conseguir, pero quien los tiene los sigue viendo
        defs: defs.filter((d) => d.active || earned.has(d.id)),
        earned,
        rates,
        progress,
      });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'No se pudieron cargar los logros');
    }
  }, [hasProfile]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /** Progreso de cada logro: el local en modo demostración (si la métrica se calcula aquí) o el del servidor */
  const valueOf = useCallback(
    (d: AchievementDef): number | null => {
      const local = demoStats ? LOCAL_METRIC[d.metric] : undefined;
      if (local && demoStats) return local(demoStats);
      return data?.progress ? Number(data.progress[d.metric] ?? 0) : null;
    },
    [data, demoStats],
  );

  /** Conseguido solo con los datos de demostración (el servidor no lo tiene) */
  const demoGot = useCallback(
    (d: AchievementDef) =>
      Boolean(demoStats && LOCAL_METRIC[d.metric] && !data?.earned.has(d.id) && (valueOf(d) ?? 0) >= Math.max(1, Number(d.threshold) || 1)),
    [data, demoStats, valueOf],
  );

  const isDone = useCallback((d: AchievementDef) => Boolean(data?.earned.has(d.id)) || demoGot(d), [data, demoGot]);

  const counts = useMemo(() => {
    const total = data?.defs.length ?? 0;
    const done = data ? data.defs.filter(isDone).length : 0;
    return { total, done, pending: total - done };
  }, [data, isDone]);

  const list = useMemo(() => {
    if (!data) return [];
    if (filter === 'done') return data.defs.filter(isDone);
    if (filter === 'pending') return data.defs.filter((d) => !isDone(d));
    return data.defs;
  }, [data, filter, isDone]);

  const FILTERS: [Filter, string, number][] = [
    ['all', 'Todos', counts.total],
    ['done', 'Conseguidos', counts.done],
    ['pending', 'Pendientes', counts.pending],
  ];

  return (
    <div className="stack fade-up">
      <div className="page-head">
        <div>
          <p className="eyebrow">Comunidad</p>
          <h1>Logros</h1>
        </div>
        {data && counts.total > 0 && (
          <span className="badge accent ach-counter">
            <Award aria-hidden="true" /> Tienes {counts.done} de {counts.total}
          </span>
        )}
      </div>

      {!ready ? (
        <SocialUnavailable what="Los logros" />
      ) : (
        <>
          {ban && <BanScreen compact />}
          {!hasProfile && !ban && !demoStats && (
            <ProfileCta text="Tu progreso en los logros empieza a contar cuando tienes un perfil público. Mientras tanto puedes ver todos los que existen." />
          )}
          {demoStats && (
            <div className="callout ach-demo-note" role="note">
              <Eye aria-hidden="true" />
              <p>
                <strong>Datos de demostración · no se publican.</strong> La racha, la XP total, los hábitos cumplidos, las monedas
                gastadas y las semanas perfectas se calculan con los datos de demostración de este dispositivo. El resto de logros
                (podio, ligas, amigos…) muestra lo que hay en el servidor.
              </p>
            </div>
          )}

          {error ? (
            <LoadError message={error} onRetry={() => void load()} />
          ) : !data ? (
            <div className="lb-loading" role="status">
              <span className="spinner" aria-hidden="true" /> Cargando los logros…
            </div>
          ) : counts.total === 0 ? (
            <div className="card">
              <div className="empty">
                <div className="empty-icon">
                  <Award aria-hidden="true" />
                </div>
                <h3>Todavía no hay logros</h3>
                <p>Muy pronto vas a encontrar aquí retos para desbloquear.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="segmented" role="group" aria-label="Filtrar logros">
                {FILTERS.map(([id, label, n]) => (
                  <button key={id} type="button" className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                    {label} <span className="ach-filter-n">{n}</span>
                  </button>
                ))}
              </div>

              {list.length === 0 ? (
                <div className="card">
                  <div className="empty">
                    <div className="empty-icon">{filter === 'done' ? <Lock aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}</div>
                    <h3>{filter === 'done' ? 'Aún no tienes logros' : '¡Los tienes todos!'}</h3>
                    <p>
                      {filter === 'done'
                        ? 'Cumple tus hábitos, mantén la racha y compite en tu liga para conseguir el primero.'
                        : 'Conseguiste todos los logros disponibles. ¡Qué constancia!'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid-auto ach-grid">
                  {list.map((d) => (
                    <AchievementCard
                      key={d.id}
                      def={d}
                      at={data.earned.get(d.id)}
                      rate={data.rates.get(d.id)}
                      value={valueOf(d)}
                      demoGot={demoGot(d)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
