import React, { useEffect, useRef, useState } from 'react';
import { Camera, Save, Trash2 } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSession } from '@/store/useSession';
import { supabase, isSupabaseConfigured } from '@/sync/supabase';
import { useToast } from '@/components/ui/ToastContext';
import { personaFor } from '@/components/coach/coachPersona';
import { Avatar, imageFileToAvatar } from '@/components/profile/Avatar';
import { playSound } from '@/lib/sound';
import type { UserGender } from '@/types';
import '@/components/profile/profile.css';

const GENDERS: [UserGender, string][] = [
  ['male', 'Hombre'],
  ['female', 'Mujer'],
  ['other', 'Otro'],
];

/**
 * PERFIL (página propia)
 * Foto, nombre y género del coach (antes estaban en Ajustes). La foto se procesa en el dispositivo (WebP 256×256)
 * y se sincroniza cifrada con el resto de ajustes. Con los perfiles públicos (docs/plan-social.md, F5) se suman
 * el alias, el banner, el marco y las tarjetas.
 */
export const ProfileView: React.FC = () => {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const email = useSession((s) => s.user?.email ?? '');
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(settings.userName || '');
  const [gender, setGender] = useState<UserGender>(settings.userGender || 'other');
  const [uploading, setUploading] = useState(false);
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const dirty = name.trim() !== (settings.userName || '').trim() || gender !== (settings.userGender || 'other');
  const persona = personaFor(gender);

  // Fecha de alta de la cuenta (viene en la sesión guardada; funciona sin conexión)
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    void supabase()
      .auth.getSession()
      .then(({ data }) => {
        const created = data.session?.user?.created_at;
        if (active && created) {
          setMemberSince(new Date(created).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      updateSettings({ avatarDataUrl: await imageFileToAvatar(file) });
      playSound.pop();
      showToast('Foto de perfil actualizada', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo usar esa imagen', 'error');
    } finally {
      setUploading(false);
    }
  };

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({ userName: name.trim(), userGender: gender });
    playSound.pop();
    showToast('Perfil guardado', 'success');
  };

  return (
    <div className="stack fade-up" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Tu cuenta</p>
          <h1>Mi perfil</h1>
        </div>
      </div>

      <section className="profile-hero" aria-label="Tu perfil">
        <div className="profile-banner" />
        <div className="profile-hero-body">
          <Avatar src={settings.avatarDataUrl} name={name || settings.userName} size={96} />
          <div className="profile-hero-name">
            <h1>{name.trim() || 'Sin nombre'}</h1>
            <p>
              {email}
              {memberSince && ` · Miembro desde el ${memberSince}`}
            </p>
          </div>
          <div className="profile-photo-actions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onPickPhoto(e)} />
            <button type="button" className="btn btn-secondary sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Camera aria-hidden /> {uploading ? 'Procesando…' : settings.avatarDataUrl ? 'Cambiar foto' : 'Subir foto'}
            </button>
            {settings.avatarDataUrl && (
              <button
                type="button"
                className="btn btn-ghost sm"
                onClick={() => {
                  updateSettings({ avatarDataUrl: undefined });
                  playSound.delete();
                }}
              >
                <Trash2 aria-hidden /> Quitar
              </button>
            )}
          </div>
        </div>
      </section>

      <form className="card form" onSubmit={onSave}>
        <div className="card-head">
          <div>
            <div className="card-title">Datos personales</div>
            <div className="card-sub">Cómo te llama tu coach y quién te acompaña</div>
          </div>
        </div>

        <div className="form-row">
          <label className="field">
            <span className="label">Tu nombre</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" required />
          </label>

          <div className="field">
            <span className="label" id="profile-gender-label">
              Te identificas como
            </span>
            <div className="gender-options" role="radiogroup" aria-labelledby="profile-gender-label">
              {GENDERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={gender === value}
                  className="gender-option"
                  onClick={() => setGender(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="hint">
              Tu coach será {persona.name}, tu {persona.role}.
            </span>
          </div>
        </div>

        <div>
          <button type="submit" className="btn btn-primary" disabled={!dirty}>
            <Save size={16} /> Guardar perfil
          </button>
        </div>
      </form>
    </div>
  );
};
