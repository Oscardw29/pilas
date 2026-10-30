import React, { useId } from 'react';
import { ALIAS_HINT, aliasUsable, useAliasStatus, type AliasStatus } from '@/components/profile/publicProfile';
import { normalizeAlias } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import './settings.css';

/**
 * ALIAS OPCIONAL (bienvenida y Ajustes › Datos personales)
 * Se escribe ya normalizado (minúsculas, números y «_») y, con el servidor disponible, se comprueba en vivo si está
 * libre. Sin alias se muestra el nombre. Nunca se dibuja «@» delante.
 */

export interface AliasCheck {
  status: AliasStatus;
  /** Se puede guardar: vacío (sin alias), libre, el actual o sin poder comprobarlo (decide el servidor al crearlo) */
  ok: boolean;
  hint: string;
}

const EMPTY_HINT = 'Opcional. De 3 a 20 letras minúsculas, números o «_». Sin alias se muestra tu nombre.';

export function useAliasCheck(alias: string, current?: string | null): AliasCheck {
  const status = useAliasStatus(alias, current);
  const server = useSocial((s) => s.available);
  // Sin la capa pública en el servidor no se puede comprobar: se reserva al crear el perfil
  const unverifiable = !server && (status === 'checking' || status === 'error');
  return {
    status,
    ok: status === 'empty' || aliasUsable(status) || unverifiable,
    hint: status === 'empty' ? EMPTY_HINT : unverifiable ? 'Se comprobará al crear tu perfil en la comunidad.' : ALIAS_HINT[status],
  };
}

export const AliasInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  check: AliasCheck;
  label?: string;
  disabled?: boolean;
}> = ({ value, onChange, check, label = 'Alias (opcional)', disabled }) => {
  const id = useId();
  const bad = check.status === 'invalid' || check.status === 'reserved' || check.status === 'taken';
  return (
    <div className="field alias-field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={`input ${bad ? 'is-bad' : ''}`}
        value={value}
        onChange={(e) => onChange(normalizeAlias(e.target.value))}
        maxLength={20}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="tu_alias"
        aria-invalid={bad}
        aria-describedby={`${id}-hint`}
        disabled={disabled}
      />
      <span id={`${id}-hint`} className={`hint alias-hint is-${check.status}`} aria-live="polite">
        {check.hint}
      </span>
    </div>
  );
};
