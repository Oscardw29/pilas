import React, { useEffect, useState } from 'react';
import { Cloud, KeyRound, LogOut, RefreshCw, Trash2 } from 'lucide-react';
import { useIsCreator } from '@/lib/creator';
import { useSession } from '@/store/useSession';
import { supabase } from '@/sync/supabase';
import { changePassword, deleteAccount, passwordProblem } from '@/account/account';
import { afterAccountDeleted, pendingChanges, signOut, syncNow } from '@/account/runtime';
import { useToast } from '@/components/ui/ToastContext';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { SyncPill } from '@/components/auth/SyncPill';

type Panel = null | 'password' | 'signout' | 'delete';

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Algo salió mal.');

function relative(ts?: number) {
  if (!ts) return 'todavía no';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return new Date(ts).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Cuenta y sincronización: estado, cambiar contraseña, cerrar sesión y eliminar la cuenta.
 */
export const AccountCard: React.FC = () => {
  const { user, lastSyncedAt, syncError } = useSession();
  const { showToast } = useToast();
  // La cuenta del creador no se puede eliminar: sostiene el panel y la IA de la app
  const isCreator = useIsCreator();
  const [panel, setPanel] = useState<Panel>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgetKeys, setForgetKeys] = useState(true);
  const [pending, setPending] = useState(0);
  /** Tras intentar subirlos, quedaron cambios sin subir: hay que confirmar que se pierden */
  const [unsynced, setUnsynced] = useState(0);
  /** Eliminar la cuenta pide una última confirmación después de la contraseña */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (panel === 'signout') void pendingChanges().then(setPending);
  }, [panel]);

  if (!user) return null;

  const open = (p: Panel) => {
    setPanel(panel === p ? null : p);
    setCurrent('');
    setNext('');
    setNext2('');
    setError(null);
    setUnsynced(0);
  };

  const onSignOut = (force: boolean) =>
    void run(async () => {
      const { pending: left } = await signOut({ forgetApiKeys: forgetKeys, force });
      if (left > 0) setUnsynced(left);
    });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== next2) return setError('Las contraseñas nuevas no coinciden.');
    const problem = passwordProblem(next);
    if (problem) return setError(problem);
    void run(async () => {
      await changePassword(supabase(), user.id, user.email, current, next);
      showToast('Contraseña cambiada', 'success', 'Úsala la próxima vez que entres en un dispositivo.');
      setPanel(null);
    });
  };

  const onDelete = (e: React.FormEvent) => {
    e.preventDefault();
    setConfirmDelete(true);
  };

  const doDelete = () => {
    void run(async () => {
      await deleteAccount(supabase(), user.id, user.email, current);
      await afterAccountDeleted();
    });
  };

  const field = (label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <label className="field">
      <span className="label">{label}</span>
      <input className="input" type="password" autoComplete={autoComplete} required value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <div className="card" style={{ borderTop: '3px solid var(--accent)' }}>
      <div className="card-head">
        <div className="row">
          <Cloud size={18} style={{ color: 'var(--accent-2)' }} />
          <div>
            <div className="card-title">Cuenta y sincronización</div>
            <div className="card-sub">{user.email}</div>
          </div>
        </div>
        <SyncPill />
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 14, lineHeight: 1.55 }}>
        Tus datos se guardan en este dispositivo y se sincronizan con tus otros dispositivos a través de tu cuenta. Si
        olvidas la contraseña, los recuperas con un código que llega a tu correo. Cada dispositivo nuevo se verifica también
        con un código del correo. Las claves API no se sincronizan. Última sincronización: {relative(lastSyncedAt)}.
      </p>
      {syncError && <p className="form-error" style={{ marginBottom: 12 }}>{syncError}</p>}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary sm" onClick={() => void syncNow()}>
          <RefreshCw aria-hidden /> Sincronizar ahora
        </button>
        <button type="button" className="btn btn-secondary sm" aria-expanded={panel === 'password'} onClick={() => open('password')}>
          <KeyRound aria-hidden /> Cambiar contraseña
        </button>
        <button type="button" className="btn btn-secondary sm" aria-expanded={panel === 'signout'} onClick={() => open('signout')}>
          <LogOut aria-hidden /> Cerrar sesión
        </button>
        {!isCreator && (
          <button type="button" className="btn btn-ghost sm" style={{ color: 'var(--danger)' }} aria-expanded={panel === 'delete'} onClick={() => open('delete')}>
            <Trash2 aria-hidden /> Eliminar cuenta
          </button>
        )}
      </div>

      {panel === 'password' && (
        <form className="form mt" onSubmit={onChangePassword}>
          {field('Contraseña actual', current, setCurrent, 'current-password')}
          {field('Contraseña nueva', next, setNext, 'new-password')}
          {field('Repite la contraseña nueva', next2, setNext2, 'new-password')}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </form>
      )}

      {panel === 'signout' && (
        <div className="form mt">
          <p className="small" style={{ color: 'var(--text-2)' }}>
            Se borrarán los datos de este dispositivo (siguen en tu cuenta). Para volver a entrar necesitarás tu contraseña.
          </p>
          {pending > 0 && (
            <p className="form-error">
              Hay {pending} cambios que aún no se subieron. Si no hay conexión al cerrar sesión, se perderán.
            </p>
          )}
          <label className="custom-switch">
            <input type="checkbox" checked={forgetKeys} onChange={(e) => setForgetKeys(e.target.checked)} />
            <span className="custom-switch-track">
              <span className="custom-switch-thumb" />
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)' }}>Olvidar también las claves API de este dispositivo</span>
          </label>
          {unsynced > 0 ? (
            <>
              <p className="form-error" role="alert">
                No se pudieron subir {unsynced} cambios. Si cierras sesión ahora, se perderán.
              </p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => onSignOut(false)}>
                  Reintentar
                </button>
                <button className="btn btn-danger-solid" type="button" disabled={busy} onClick={() => onSignOut(true)}>
                  Cerrar sesión y perderlos
                </button>
              </div>
            </>
          ) : (
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => onSignOut(false)}>
              {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
            </button>
          )}
        </div>
      )}

      {panel === 'delete' && (
        <form className="form mt" onSubmit={onDelete}>
          <p className="form-error">
            Se borrarán tu cuenta y todos tus datos en la nube y en este dispositivo. No se puede deshacer.
          </p>
          {field('Contraseña para confirmar', current, setCurrent, 'current-password')}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-danger-solid" type="submit" disabled={busy}>
            {busy ? 'Eliminando…' : 'Eliminar mi cuenta para siempre'}
          </button>
        </form>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        title="¿Eliminar tu cuenta para siempre?"
        message="Se borrarán tu cuenta, tu perfil público y todos tus datos en la nube y en este dispositivo. No se puede deshacer."
        confirmLabel="Eliminar mi cuenta"
        confirmVariant="danger"
      />
    </div>
  );
};
