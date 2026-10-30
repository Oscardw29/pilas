import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useToast } from '@/components/ui/ToastContext';
import { useSecrets } from '@/store/useSecrets';

/**
 * CLAVES CIFRADAS DE VERSIONES ANTERIORES
 * Ya no se pueden cifrar las claves con contraseña. Solo si este dispositivo las tenía así aparece esta tarjeta, una
 * vez: con la contraseña vuelven a quedar como las demás; también se pueden olvidar y pegarlas de nuevo.
 */
export const LockedKeysCard: React.FC = () => {
  const { locked, unlock, disableEncryption, forgetAll } = useSecrets(
    useShallow((s) => ({ locked: s.locked, unlock: s.unlock, disableEncryption: s.disableEncryption, forgetAll: s.forgetAll })),
  );
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!locked) return null;

  const recover = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await unlock(password);
    setBusy(false);
    if (!ok) {
      showToast('Contraseña incorrecta', 'error');
      return;
    }
    disableEncryption();
    setPassword('');
    showToast('Tus claves ya están disponibles', 'success');
  };

  return (
    <div className="callout attention">
      <KeyRound aria-hidden="true" />
      <div className="grow">
        <div className="title">Tus claves de API están cifradas</div>
        <div className="detail">Escribe la contraseña que usaste para cifrarlas y vuelve a tenerlas disponibles en este dispositivo.</div>
        <form className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }} onSubmit={(e) => void recover(e)}>
          <input
            type="password"
            className="input"
            style={{ flex: '1 1 200px' }}
            autoComplete="current-password"
            placeholder="Contraseña de las claves"
            aria-label="Contraseña de las claves"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="btn btn-primary sm" disabled={busy || !password}>
            Recuperar claves
          </button>
          <button type="button" className="btn btn-ghost sm" onClick={forgetAll}>
            Olvidarlas
          </button>
        </form>
      </div>
    </div>
  );
};
