import React, { useRef } from 'react';
import { Camera } from 'lucide-react';
import { DEFAULT_AVATARS, type DefaultAvatarId } from '@/lib/defaultAvatars';
import './settings.css';

export type AvatarChoice = DefaultAvatarId | 'own';

/**
 * Selector de la foto de perfil: las 5 fotos por defecto en círculos y, si se pasa `onUpload`, la opción de subir una
 * propia. Es un grupo de botones tipo radio (no controles nativos): flechas para moverse, Inicio/Fin y foco en el
 * elegido, como un radiogroup del sistema.
 */
export const AvatarPresetPicker: React.FC<{
  value: AvatarChoice;
  onChange: (v: AvatarChoice) => void;
  /** Foto propia ya elegida (data URL): aparece como una opción más */
  ownPhoto?: string;
  onUpload?: (file: File) => void;
  uploading?: boolean;
  labelledBy?: string;
}> = ({ value, onChange, ownPhoto, onUpload, uploading, labelledBy }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const options: { id: AvatarChoice; label: string; src: string }[] = [
    ...DEFAULT_AVATARS.map((a) => ({ id: a.id as AvatarChoice, label: a.label, src: a.src })),
    ...(ownPhoto ? [{ id: 'own' as const, label: 'Tu foto', src: ownPhoto }] : []),
  ];
  const current = options.some((o) => o.id === value) ? value : options[0].id;

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (index + 1) % options.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (index - 1 + options.length) % options.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].id);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div className="avatar-picker">
      <div ref={groupRef} className="avatar-picker-options" role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : 'Foto de perfil'}>
        {options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={current === o.id}
            aria-label={o.label}
            title={o.label}
            tabIndex={current === o.id ? 0 : -1}
            className="avatar-picker-option"
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <img src={o.src} alt="" draggable={false} />
          </button>
        ))}
      </div>
      {onUpload && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onUpload(file);
            }}
          />
          <button type="button" className="btn btn-ghost sm avatar-picker-upload" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Camera aria-hidden /> {uploading ? 'Procesando…' : ownPhoto ? 'Cambiar tu foto' : 'Subir tu foto'}
          </button>
        </>
      )}
    </div>
  );
};
