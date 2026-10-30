import React from 'react';
import { Ban as BanIcon } from 'lucide-react';
import { useSocial } from '@/social/useSocial';
import './social.css';

/**
 * Pantalla del veto: quien tiene un veto activo no puede escribir nada público (lo impide el servidor).
 * Sus hábitos, notas y todo lo privado siguen funcionando con normalidad.
 */
export const BanScreen: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const ban = useSocial((s) => s.ban);
  if (!ban) return null;
  const ends = ban.ends_at
    ? new Date(ban.ends_at).toLocaleString('es', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <section className="ban-screen" role="alert" style={compact ? { padding: '20px 16px' } : undefined}>
      <BanIcon size={compact ? 26 : 34} color="var(--danger)" aria-hidden="true" />
      <h2>{ends ? 'Veto temporal' : 'Veto permanente'}</h2>
      <p>
        <strong>Motivo:</strong> {ban.reason}
      </p>
      <p>{ends ? `Termina el ${ends}.` : 'No tiene fecha de fin.'}</p>
      <p className="muted" style={{ fontSize: 13 }}>
        Mientras dure no puedes publicar, reaccionar, enviar ánimos ni cambiar tu perfil público. Tus hábitos y todo lo privado
        siguen funcionando.
      </p>
    </section>
  );
};
