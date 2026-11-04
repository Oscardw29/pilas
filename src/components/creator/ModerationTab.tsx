import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, Check, Coins, ExternalLink, ImageOff, RotateCcw, ShieldCheck, Sparkles, UserX, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/ToastContext';
import { Avatar, PersonAvatar } from '@/components/profile/Avatar';
import { AccountsPanel } from './AccountsPanel';
import {
  adminAccounts, adminActions, adminAdjustCoins, adminAdjustXp, adminBan, adminClearAvatar, adminClearBanner, adminReports, adminResolveReport, adminUnban, adminUser,
  adminWarn, assetUrl, removeAvatarFiles, SocialError,
} from '@/social/api';
import { personName, profilePath, REPORT_REASONS, timeAgo } from '@/social/texts';
import type { AdminAccount, AdminUserOverview, ModerationAction, Person, ReportRow } from '@/social/types';
import { useSession } from '@/store/useSession';

type ActionKind = 'avatar' | 'banner' | 'warn' | 'ban' | 'unban' | 'coins' | 'xp';

const ACTION_INFO: Record<ActionKind, { title: string; confirm: string; danger?: boolean; help: string }> = {
  avatar: { title: 'Borrar la foto de perfil', confirm: 'Borrar foto', danger: true, help: 'La foto se elimina del servidor y vuelve a verse con sus iniciales.' },
  banner: { title: 'Quitar el banner', confirm: 'Quitar banner', danger: true, help: 'Se le quita el banner equipado. Lo sigue teniendo en su inventario.' },
  warn: { title: 'Advertir', confirm: 'Enviar advertencia', help: 'Recibe una notificación con el motivo.' },
  ban: { title: 'Vetar', confirm: 'Vetar', danger: true, help: 'Mientras dure el veto no puede usar lo social y su perfil se oculta.' },
  unban: { title: 'Levantar el veto', confirm: 'Levantar veto', help: 'El veto activo termina ahora.' },
  coins: { title: 'Ajustar monedas', confirm: 'Ajustar monedas', help: 'Positivo para dar, negativo para quitar. Recibe un aviso y queda registrado.' },
  xp: { title: 'Ajustar XP', confirm: 'Ajustar XP', help: 'Positivo para sumar, negativo para restar. Queda registrado.' },
};

const ACTION_LABEL: Record<string, string> = {
  warn: 'Advertencia',
  ban: 'Veto',
  unban: 'Veto levantado',
  remove_avatar: 'Foto borrada',
  remove_banner: 'Banner quitado',
  adjust_coins: 'Ajuste de monedas',
  adjust_xp: 'Ajuste de XP',
  delete_account: 'Cuenta eliminada',
  delete_post: 'Publicación borrada',
  resolve_report: 'Reporte revisado',
  publish_economy: 'Economía publicada',
  revert_economy: 'Economía revertida',
  close_week: 'Cierre de semana',
};

const STAT_LABEL: Record<string, string> = {
  xp_total: 'XP total',
  best_streak: 'Mejor racha',
  habits_done: 'Hábitos cumplidos',
  xp_adjust: 'Ajuste de XP',
  baseline_streak: 'Racha inicial',
  baseline_best: 'Mejor racha inicial',
  baseline_xp: 'XP inicial',
  baseline_coins: 'Monedas iniciales',
  baseline_done: 'Hábitos iniciales',
  baseline_at: 'Punto de partida',
  last_day: 'Último día publicado',
  updated_at: 'Actualizado',
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const fmtStat = (k: string, v: unknown) => {
  if (v == null) return '—';
  if (/_at$/.test(k)) return fmtDate(String(v));
  // XP, monedas, rachas y hábitos son siempre enteros
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))) return Math.round(Number(v)).toLocaleString('es');
  return String(v);
};

const reasonLabel = (r: ReportRow['reason']) => REPORT_REASONS.find((x) => x.id === r)?.label ?? r;

/** Para buscar a alguien en el panel: su alias o, si no tiene alias, su id */
const handleOf = (p: { alias?: string | null; user_id: string }) => p.alias || p.user_id;

const PersonLink: React.FC<{ person?: Person | null; fallback?: string }> = ({ person, fallback = 'Desconocido' }) =>
  person ? (
    <Link to={profilePath(person)} className="creator-link row" style={{ gap: 6, display: 'inline-flex' }}>
      <PersonAvatar person={person} size={24} />
      {personName(person)}
    </Link>
  ) : (
    <span className="muted">{fallback}</span>
  );

/** Pide el motivo (y la cantidad o los días) y ejecuta la acción de moderación */
const ActionModal: React.FC<{ kind: ActionKind; user: AdminUserOverview; onClose: () => void; onDone: () => void }> = ({ kind, user, onClose, onDone }) => {
  const { showToast } = useToast();
  const info = ACTION_INFO[kind];
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('7');
  const [permanent, setPermanent] = useState(false);
  const [busy, setBusy] = useState(false);
  const uid = user.profile.user_id;

  const run = async () => {
    const r = reason.trim();
    if (!r || r.length > 500) {
      showToast('Escribe el motivo (hasta 500 caracteres).', 'warning');
      return;
    }
    const n = Number(amount);
    // XP y monedas son siempre enteras
    if ((kind === 'coins' || kind === 'xp') && (!Number.isInteger(n) || n === 0)) {
      showToast('Escribe una cantidad entera distinta de 0 (negativa para quitar).', 'warning');
      return;
    }
    const d = Number(days);
    if (kind === 'ban' && !permanent && (!Number.isInteger(d) || d < 1 || d > 3650)) {
      showToast('Los días del veto van de 1 a 3650.', 'warning');
      return;
    }
    setBusy(true);
    try {
      switch (kind) {
        case 'avatar': {
          const path = user.profile.avatar_path;
          await adminClearAvatar(uid, r);
          if (path) void removeAvatarFiles([path]).catch(() => {});
          break;
        }
        case 'banner':
          await adminClearBanner(uid, r);
          break;
        case 'warn':
          await adminWarn(uid, r);
          break;
        case 'ban':
          await adminBan(uid, r, permanent ? null : d);
          break;
        case 'unban':
          await adminUnban(uid, r);
          break;
        case 'coins': {
          const balance = await adminAdjustCoins(uid, n, r);
          showToast(`Saldo nuevo: ${Math.round(Number(balance)).toLocaleString('es')} monedas`, 'success');
          break;
        }
        case 'xp': {
          const xp = await adminAdjustXp(uid, n, r);
          showToast(`XP total nueva: ${Math.round(Number(xp)).toLocaleString('es')}`, 'success');
          break;
        }
      }
      if (kind !== 'coins' && kind !== 'xp') showToast(`${info.title}: hecho`, 'success');
      onDone();
      onClose();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`${info.title} · ${personName(user.profile)}`}>
      <form
        id="mod-action-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>{info.help}</p>
        {(kind === 'coins' || kind === 'xp') && (
          <label className="field">
            <span className="label">Cantidad (±)</span>
            <input
              className="input"
              inputMode="numeric"
              value={amount}
              // Solo enteros (con signo): XP y monedas nunca llevan decimales
              onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '').slice(0, 9))}
              placeholder="Ej.: 100 o -50"
              data-autofocus
            />
          </label>
        )}
        {kind === 'ban' && (
          <div className="form-row">
            <label className="field">
              <span className="label">Días</span>
              <input
                className="input"
                inputMode="numeric"
                value={days}
                disabled={permanent}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </label>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <label className="custom-switch">
                <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
                <span className="custom-switch-track">
                  <span className="custom-switch-thumb" />
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>Permanente</span>
              </label>
            </div>
          </div>
        )}
        <label className="field">
          <span className="label">Motivo</span>
          <textarea className="textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Queda en el registro de acciones" />
          <span className="hint">{kind === 'warn' || kind === 'ban' || kind === 'coins' ? 'La persona verá este motivo.' : 'Solo lo ves tú.'}</span>
        </label>
      </form>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" form="mod-action-form" className={`btn ${info.danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={busy}>
          {busy ? 'Aplicando…' : info.confirm}
        </button>
      </div>
    </Modal>
  );
};

type ReportItem = Awaited<ReturnType<typeof adminReports>>[number];

/** Moderación: todas las cuentas, acciones sobre cada persona, cola de reportes y registro de acciones */
export const ModerationTab: React.FC = () => {
  const { showToast } = useToast();
  const myId = useSession((s) => s.user?.id);
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [accountsMissing, setAccountsMissing] = useState(false);
  const [user, setUser] = useState<AdminUserOverview | null>(null);
  const [searched, setSearched] = useState<string | null>(null);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [reportFilter, setReportFilter] = useState<'open' | 'all'>('open');
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  const [log, setLog] = useState<(ModerationAction & { target?: Person | null })[] | null>(null);
  const [busyReport, setBusyReport] = useState<number | null>(null);

  /** `handle` = alias (sin «@») o, para quien no tiene alias, su id */
  const lookup = useCallback(
    async (handle: string) => {
      const a = handle.trim().replace(/^@+/, '').toLowerCase();
      if (!a) return;
      try {
        const u = await adminUser(a);
        setUser(u);
        setSearched(a);
      } catch (err) {
        showToast((err as Error).message, 'error');
      }
    },
    [showToast],
  );

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await adminAccounts());
    } catch (err) {
      if (err instanceof SocialError && err.code === 'PGRST202') setAccountsMissing(true);
      else {
        showToast((err as Error).message, 'error');
        setAccounts((p) => p ?? []);
      }
    }
  }, [showToast]);

  const loadReports = useCallback(async () => {
    try {
      setReports(await adminReports(reportFilter));
    } catch (err) {
      showToast((err as Error).message, 'error');
      setReports((p) => p ?? []);
    }
  }, [reportFilter, showToast]);

  const loadLog = useCallback(async () => {
    try {
      setLog(await adminActions());
    } catch (err) {
      showToast((err as Error).message, 'error');
      setLog((p) => p ?? []);
    }
  }, [showToast]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);
  useEffect(() => {
    void loadReports();
  }, [loadReports]);
  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  const resolve = async (r: ReportItem, status: ReportRow['status']) => {
    setBusyReport(r.id);
    try {
      await adminResolveReport(r.id, status);
      showToast(status === 'resolved' ? 'Reporte resuelto' : status === 'dismissed' ? 'Reporte descartado' : 'Reporte reabierto', 'success');
      await Promise.all([loadReports(), loadLog()]);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusyReport(null);
    }
  };

  const open = async (handle: string) => {
    await lookup(handle);
    document.getElementById('mod-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const p = user?.profile;
  const isMe = p?.user_id === myId;
  const stats = user?.stats ?? null;
  const statKeys = stats ? Object.keys(stats).filter((k) => k !== 'user_id') : [];

  return (
    <div className="stack">
      <div className="card" id="mod-user">
        <div className="card-head">
          <div>
            <h2 className="card-title">Personas registradas{accounts ? ` (${accounts.length})` : ''}</h2>
            <p className="card-sub">Todas las cuentas, también la tuya. Gestionar abre sus datos y acciones; cada acción queda en el registro.</p>
          </div>
          <button type="button" className="btn btn-ghost sm" onClick={() => void loadAccounts()}>
            <RotateCcw /> Actualizar
          </button>
        </div>

        <AccountsPanel
          accounts={accounts}
          missing={accountsMissing}
          onManage={(a) => void open(handleOf({ alias: a.alias, user_id: a.user_id }))}
          onChanged={() => {
            setUser(null);
            setSearched(null);
            void loadAccounts();
            void loadLog();
          }}
        />

        <div id="mod-detail" />
        {searched && !user && (
          <p className="muted" style={{ marginTop: 14 }}>
            No hay ningún perfil con «{searched}».
          </p>
        )}

        {user && p && (
          <div className="stack" style={{ marginTop: 18, gap: 16 }}>
            <div className="mod-head">
              <Avatar src={assetUrl('avatars', p.avatar_path)} name={personName(p)} size={56} />
              <div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <strong style={{ fontSize: 16 }}>{personName(p)}</strong>
                  {p.alias && p.display_name?.trim() && p.display_name.trim() !== p.alias && (
                    <span className="card-sub">{p.display_name.trim()}</span>
                  )}
                  {user.banned ? <span className="badge danger">Vetado</span> : <span className="badge success">Activo</span>}
                </div>
                <span className="card-sub">Miembro desde {fmtDate(p.member_since)}</span>
              </div>
              <Link to={profilePath(p)} className="btn btn-secondary sm">
                <ExternalLink /> Ver perfil
              </Link>
            </div>

            <dl className="mod-stats">
              <div>
                <dt>Saldo</dt>
                <dd>{Math.round(Number(user.balance)).toLocaleString('es')} monedas</dd>
              </div>
              <div>
                <dt>Racha actual</dt>
                <dd>{user.current_streak} días</dd>
              </div>
              {statKeys.map((k) => (
                <div key={k}>
                  <dt>{STAT_LABEL[k] ?? k}</dt>
                  <dd>{fmtStat(k, stats![k])}</dd>
                </div>
              ))}
            </dl>

            <div className="mod-actions">
              <button type="button" className="btn btn-secondary sm" disabled={!p.avatar_path} onClick={() => setAction('avatar')}>
                <ImageOff /> Borrar foto
              </button>
              <button type="button" className="btn btn-secondary sm" disabled={!p.banner_item} onClick={() => setAction('banner')}>
                <X /> Quitar banner
              </button>
              {!isMe && (
                <button type="button" className="btn btn-secondary sm" onClick={() => setAction('warn')}>
                  <AlertTriangle /> Advertir
                </button>
              )}
              {isMe ? null : user.banned ? (
                <button type="button" className="btn btn-success sm" onClick={() => setAction('unban')}>
                  <ShieldCheck /> Levantar veto
                </button>
              ) : (
                <button type="button" className="btn btn-danger sm" onClick={() => setAction('ban')}>
                  <Ban /> Vetar
                </button>
              )}
              <button type="button" className="btn btn-secondary sm" onClick={() => setAction('coins')}>
                <Coins /> Ajustar monedas
              </button>
              <button type="button" className="btn btn-secondary sm" onClick={() => setAction('xp')}>
                <Sparkles /> Ajustar XP
              </button>
            </div>

            <div className="form-row">
              <div>
                <h3 className="creator-section-title">Vetos</h3>
                {user.bans.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>
                    Ninguno.
                  </p>
                ) : (
                  <ul className="mod-history">
                    {user.bans.map((b) => (
                      <li key={b.id}>
                        <strong>{b.ends_at ? `Hasta ${fmtDate(b.ends_at)}` : 'Permanente'}</strong>
                        {b.lifted_at && <span className="badge" style={{ marginLeft: 6 }}>Levantado {fmtDate(b.lifted_at)}</span>}
                        <div className="card-sub">
                          {fmtDate(b.starts_at)} · {b.reason}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="creator-section-title">Advertencias</h3>
                {user.warnings.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>
                    Ninguna.
                  </p>
                ) : (
                  <ul className="mod-history">
                    {user.warnings.map((w) => (
                      <li key={w.id}>
                        <div className="card-sub">{fmtDate(w.created_at)}</div>
                        {w.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div>
            <h2 className="card-title">Reportes</h2>
            <p className="card-sub">Lo que otras personas han reportado. Revisa el perfil antes de actuar.</p>
          </div>
          <div className="segmented" role="tablist" aria-label="Filtrar reportes">
            {(['open', 'all'] as const).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={reportFilter === f} className={reportFilter === f ? 'active' : ''} onClick={() => setReportFilter(f)}>
                {f === 'open' ? 'Pendientes' : 'Todos'}
              </button>
            ))}
          </div>
        </div>
        {reports === null ? (
          <p className="muted">Cargando…</p>
        ) : reports.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {reportFilter === 'open' ? 'No hay reportes pendientes.' : 'Todavía no hay reportes.'}
          </p>
        ) : (
          <div className="creator-table-wrap">
            <table className="creator-table">
              <thead>
                <tr>
                  <th scope="col">Reportado</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Detalles</th>
                  <th scope="col">Quién</th>
                  <th scope="col">Cuándo</th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className="creator-sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <PersonLink person={r.target} fallback="Perfil borrado" />
                    </td>
                    <td>{reasonLabel(r.reason)}</td>
                    <td className="wrap">
                      {r.details || <span className="muted">—</span>}
                      {r.post_id && <div className="card-sub">Sobre una publicación</div>}
                    </td>
                    <td>
                      <PersonLink person={r.reporterPerson} fallback="Cuenta borrada" />
                    </td>
                    <td title={fmtDate(r.created_at)}>{timeAgo(r.created_at)}</td>
                    <td>
                      <span className={`badge ${r.status === 'open' ? 'warning' : r.status === 'resolved' ? 'success' : ''}`}>
                        {r.status === 'open' ? 'Pendiente' : r.status === 'resolved' ? 'Resuelto' : 'Descartado'}
                      </span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {r.target && (
                          <button type="button" className="btn btn-ghost sm" onClick={() => void open(handleOf(r.target!))}>
                            <UserX /> Moderar
                          </button>
                        )}
                        {r.status === 'open' ? (
                          <>
                            <button type="button" className="btn btn-success sm" disabled={busyReport === r.id} onClick={() => void resolve(r, 'resolved')}>
                              <Check /> Resolver
                            </button>
                            <button type="button" className="btn btn-ghost sm" disabled={busyReport === r.id} onClick={() => void resolve(r, 'dismissed')}>
                              Descartar
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn btn-ghost sm" disabled={busyReport === r.id} onClick={() => void resolve(r, 'open')}>
                            <RotateCcw /> Reabrir
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Registro de acciones</h2>
            <p className="card-sub">Las últimas 100 acciones del panel.</p>
          </div>
          <button type="button" className="btn btn-ghost sm" onClick={() => void loadLog()}>
            <RotateCcw /> Actualizar
          </button>
        </div>
        {log === null ? (
          <p className="muted">Cargando…</p>
        ) : log.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Todavía no hay acciones.
          </p>
        ) : (
          <div className="creator-table-wrap">
            <table className="creator-table">
              <thead>
                <tr>
                  <th scope="col">Cuándo</th>
                  <th scope="col">Acción</th>
                  <th scope="col">Persona</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Datos</th>
                </tr>
              </thead>
              <tbody>
                {log.map((a) => (
                  <tr key={a.id}>
                    <td title={fmtDate(a.created_at)}>{timeAgo(a.created_at)}</td>
                    <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                    <td>{a.target_user ? <PersonLink person={a.target} fallback="Sin perfil" /> : <span className="muted">—</span>}</td>
                    <td className="wrap">{a.reason || <span className="muted">—</span>}</td>
                    <td className="wrap">
                      {a.data && Object.keys(a.data).length ? <code style={{ fontSize: 11.5 }}>{JSON.stringify(a.data)}</code> : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {action && user && (
        <ActionModal
          kind={action}
          user={user}
          onClose={() => setAction(null)}
          onDone={() => {
            void lookup(handleOf(user.profile));
            void loadAccounts();
            void loadLog();
          }}
        />
      )}
    </div>
  );
};
