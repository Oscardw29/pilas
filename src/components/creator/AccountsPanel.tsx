import React, { useMemo, useState } from 'react';
import { Trash2, UserCog } from 'lucide-react';
import { Avatar } from '@/components/profile/Avatar';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/ToastContext';
import { adminDeleteAccount, assetUrl } from '@/social/api';
import { personName } from '@/social/texts';
import type { AdminAccount } from '@/social/types';
import { useSession } from '@/store/useSession';

const CONFIRM_WORD = 'ELIMINAR';

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const accountName = (a: AdminAccount) => (a.has_profile ? personName(a) : a.email || 'Sin nombre');

/** Eliminar la cuenta de otra persona: pide motivo y escribir ELIMINAR */
const DeleteAccountModal: React.FC<{ account: AdminAccount; onClose: () => void; onDone: () => void }> = ({ account, onClose, onDone }) => {
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = word.trim() === CONFIRM_WORD && Boolean(reason.trim());

  const run = async () => {
    setBusy(true);
    try {
      await adminDeleteAccount(account.user_id, reason.trim());
      showToast('Cuenta eliminada', 'success');
      onDone();
      onClose();
    } catch (err) {
      showToast((err as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Eliminar la cuenta · ${accountName(account)}`}>
      <form
        id="mod-delete-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) void run();
        }}
      >
        <p style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
          Se borran para siempre la cuenta y todos sus datos: hábitos, perfil, publicaciones, monedas y amistades. No se puede deshacer.
        </p>
        <label className="field">
          <span className="label">Motivo</span>
          <textarea className="textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Queda en el registro de acciones" />
        </label>
        <label className="field">
          <span className="label">Escribe {CONFIRM_WORD} para confirmar</span>
          <input className="input" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value)} />
        </label>
      </form>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" form="mod-delete-form" className="btn btn-danger-solid" disabled={busy || !ready}>
          {busy ? 'Eliminando…' : 'Eliminar para siempre'}
        </button>
      </div>
    </Modal>
  );
};

/** Todas las cuentas registradas, con o sin perfil público, incluida la del creador */
export const AccountsPanel: React.FC<{
  accounts: AdminAccount[] | null;
  missing: boolean;
  onManage: (account: AdminAccount) => void;
  onChanged: () => void;
}> = ({ accounts, missing, onManage, onChanged }) => {
  const me = useSession((s) => s.user?.id);
  const [filter, setFilter] = useState('');
  const [deleting, setDeleting] = useState<AdminAccount | null>(null);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!accounts || !q) return accounts ?? [];
    return accounts.filter((a) => [a.alias, a.display_name, a.email, a.user_id].some((v) => v?.toLowerCase().includes(q)));
  }, [accounts, filter]);

  if (missing) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        Aplica <code>supabase/migrations/0005_cuentas_panel.sql</code> en el editor SQL de Supabase para ver aquí todas las cuentas.
      </p>
    );
  }
  if (!accounts) return <p className="muted">Cargando…</p>;

  return (
    <>
      <input
        className="input"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filtrar por nombre, alias, correo o id"
        aria-label="Filtrar personas"
        autoCapitalize="none"
        spellCheck={false}
        style={{ marginBottom: 12 }}
      />
      {shown.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Nadie coincide con ese filtro.
        </p>
      ) : (
        <div className="creator-table-wrap">
          <table className="creator-table">
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Correo</th>
                <th scope="col">Registro</th>
                <th scope="col">Último acceso</th>
                <th scope="col">Estado</th>
                <th scope="col">
                  <span className="creator-sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const isMe = a.user_id === me;
                return (
                  <tr key={a.user_id}>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <Avatar src={assetUrl('avatars', a.avatar_path)} name={accountName(a)} size={28} />
                        {accountName(a)}
                        {isMe && <span className="badge accent">Tú</span>}
                      </span>
                    </td>
                    <td>{a.email || '—'}</td>
                    <td>{fmtDate(a.created_at)}</td>
                    <td>{fmtDate(a.last_sign_in_at)}</td>
                    <td>
                      {a.banned ? (
                        <span className="badge danger">Vetado</span>
                      ) : a.is_admin ? (
                        <span className="badge accent">Creador</span>
                      ) : !a.email_confirmed_at ? (
                        <span className="badge warning">Sin verificar</span>
                      ) : !a.has_profile ? (
                        <span className="badge">Sin perfil</span>
                      ) : (
                        <span className="badge success">Activa</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button type="button" className="btn btn-ghost sm" disabled={!a.has_profile} title={a.has_profile ? undefined : 'Aún no tiene perfil público'} onClick={() => onManage(a)}>
                          <UserCog aria-hidden="true" /> Gestionar
                        </button>
                        {!a.is_admin && (
                          <button type="button" className="btn btn-ghost sm" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(a)}>
                            <Trash2 aria-hidden="true" /> Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {deleting && <DeleteAccountModal account={deleting} onClose={() => setDeleting(null)} onDone={onChanged} />}
    </>
  );
};
