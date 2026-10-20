import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { KeyRound, Lock, Unlock, Trash2 } from 'lucide-react';
import { useSecrets } from '@/store/useSecrets';
import { useToast } from '@/components/ui/ToastContext';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

/**
 * Seguridad de las claves de API: cifrado local opcional (AES-GCM + PBKDF2), bloqueo y borrado.
 */
export const ApiKeySecurityCard: React.FC<{ onKeysForgotten: () => void }> = ({ onKeysForgotten }) => {
  const { secretsMode, secretsLocked, enableEncryption, disableEncryption, unlockSecrets, lockSecrets, forgetSecrets } = useSecrets(
    useShallow((s) => ({
      secretsMode: s.mode,
      secretsLocked: s.locked,
      enableEncryption: s.enableEncryption,
      disableEncryption: s.disableEncryption,
      unlockSecrets: s.unlock,
      lockSecrets: s.lock,
      forgetSecrets: s.forgetAll,
    }))
  );
  const { showToast } = useToast();
  const [secPassword, setSecPassword] = useState('');
  const [secBusy, setSecBusy] = useState(false);
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);

  // Seguridad de claves: cifrado local con contraseña
  const handleEnableEncryption = async () => {
    setSecBusy(true);
    try {
      await enableEncryption(secPassword);
      setSecPassword('');
      showToast('Claves cifradas. Tendrás que desbloquearlas con tu contraseña cada vez que abras la app.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'No se pudo activar el cifrado', 'error');
    } finally {
      setSecBusy(false);
    }
  };

  const handleUnlock = async () => {
    setSecBusy(true);
    const ok = await unlockSecrets(secPassword);
    setSecBusy(false);
    if (ok) {
      setSecPassword('');
      showToast('Claves desbloqueadas para esta sesión', 'success');
    } else {
      showToast('Contraseña incorrecta', 'error');
    }
  };

  const confirmForgetSecrets = () => {
    forgetSecrets();
    onKeysForgotten();
    setShowForgetConfirm(false);
    showToast('Se eliminaron todas las claves de API de este navegador', 'info');
  };

  return (
    <>
        {/* Seguridad de las claves de API */}
        <div className="card">
          <div className="card-head">
            <div className="row">
              <KeyRound size={18} style={{ color: 'var(--accent-2)' }} />
              <div>
                <div className="card-title">Seguridad de las claves de API</div>
                <div className="card-sub">
                  {secretsMode === 'enc'
                    ? secretsLocked
                      ? 'Cifradas con contraseña · bloqueadas'
                      : 'Cifradas con contraseña · desbloqueadas en esta sesión'
                    : 'Guardadas sin cifrar en este navegador'}
                </div>
              </div>
            </div>
            <span className={`badge ${secretsMode === 'enc' ? 'success' : ''}`}>
              {secretsMode === 'enc' ? <Lock size={12} /> : <Unlock size={12} />}
              {secretsMode === 'enc' ? 'Cifrado activo' : 'Sin cifrar'}
            </span>
          </div>

          <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 14 }}>
            Las claves nunca se incluyen en los respaldos exportados. Puedes cifrarlas con una contraseña local (AES-GCM): solo
            se descifran en memoria al desbloquearlas. La contraseña no se guarda; si la olvidas tendrás que volver a introducir las claves.
          </p>

          {!(secretsMode === 'enc' && !secretsLocked) && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <input
                type="password"
                className="input"
                style={{ flex: '1 1 220px' }}
                autoComplete={secretsLocked ? 'current-password' : 'new-password'}
                placeholder={secretsLocked ? 'Contraseña de las claves' : 'Nueva contraseña (mín. 6 caracteres)'}
                aria-label={secretsLocked ? 'Contraseña de las claves' : 'Nueva contraseña para cifrar las claves'}
                value={secPassword}
                onChange={(e) => setSecPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (secretsLocked) handleUnlock();
                    else handleEnableEncryption();
                  }
                }}
              />
              {secretsLocked ? (
                <button type="button" className="btn btn-primary" disabled={secBusy || !secPassword} onClick={handleUnlock}>
                  <Unlock size={15} /> Desbloquear
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" disabled={secBusy || secPassword.length < 6} onClick={handleEnableEncryption}>
                  <Lock size={15} /> Cifrar claves
                </button>
              )}
            </div>
          )}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {secretsMode === 'enc' && !secretsLocked && (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => { lockSecrets(); showToast('Claves bloqueadas', 'info'); }}>
                  <Lock size={15} /> Bloquear ahora
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => { disableEncryption(); showToast('Cifrado desactivado', 'info'); }}>
                  <Unlock size={15} /> Quitar cifrado
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: 'var(--danger)' }}
              onClick={() => setShowForgetConfirm(true)}
            >
              <Trash2 size={15} /> Olvidar todas las claves
            </button>
          </div>
        </div>

        {/* Modal Confirmación Olvidar claves */}
        <ConfirmModal
          isOpen={showForgetConfirm}
          onClose={() => setShowForgetConfirm(false)}
          onConfirm={confirmForgetSecrets}
          title="¿Olvidar todas las claves de API?"
          message="Se borrará de este navegador la clave de IA (y su cifrado, si lo tenías). Tendrás que volver a introducirla para usar el Coach con IA."
          confirmLabel="Olvidar claves"
          confirmVariant="danger"
          zIndex={1300}
        />
    </>
  );
};
