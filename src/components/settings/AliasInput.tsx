import React, { useId } from 'react';
import { Pencil } from 'lucide-react';
import { ALIAS_HINT, aliasUsable, useAliasStatus, type AliasStatus } from '@/components/profile/publicProfile';
import { normalizeAlias } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import './settings.css';

/**
 * ALIAS OPCIONAL (bienvenida, Ajustes › Datos personales y modo edición del perfil)
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

const isBadAlias = (check: AliasCheck) => check.status === 'invalid' || check.status === 'reserved' || check.status === 'taken';

/** El alias escrito en el mismo sitio y con la misma letra que el nombre del perfil. Vacío, se ve el nombre (`fallback`) */
export const AliasNameInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  check: AliasCheck;
  fallback: string;
  disabled?: boolean;
}> = ({ value, onChange, check, fallback, disabled }) => {
  const id = useId();
  const bad = isBadAlias(check);
  return (
    <div className="ph-name-edit">
      <div className={`ph-name-field ${bad ? 'is-bad' : ''}`}>
        <input
          className="ph-name"
          value={value}
          onChange={(e) => onChange(normalizeAlias(e.target.value))}
          maxLength={20}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={fallback}
          aria-label="Alias"
          aria-invalid={bad}
          aria-describedby={`${id}-hint`}
          disabled={disabled}
        />
        <Pencil aria-hidden="true" />
      </div>
      <span id={`${id}-hint`} className={`hint alias-hint is-${check.status}`} aria-live="polite">
        {check.hint}
      </span>
    </div>
  );
};

export const AliasInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  check: AliasCheck;
  label?: string;
  disabled?: boolean;
}> = ({ value, onChange, check, label = 'Alias (opcional)', disabled }) => {
  const id = useId();
  const bad = isBadAlias(check);
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
