import React, { useEffect, useRef, useState } from 'react';
import { Camera, Save, Trash2 } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useSession } from '@/store/useSession';
import { supabase, isSupabaseConfigured } from '@/sync/supabase';
import { useToast } from '@/components/ui/ToastContext';
import { personaFor } from '@/components/coach/coachPersona';
import { MyAvatar, imageFileToAvatar } from '@/components/profile/Avatar';
import { PublicProfileCard } from '@/components/profile/PublicProfileCard';
import { reportSocialError, syncPublicAvatar } from '@/components/profile/publicProfile';
import { ProfileBanner, cosmeticOf } from '@/components/social/Identity';
import { useCatalogItem, useSocial } from '@/social/useSocial';
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
 * y se sincroniza cifrada con el resto de ajustes. Con perfil público (docs/plan-social.md, F5) la misma foto se
 * sube también al servidor (WebP) y se suman el alias, el banner, el marco, las tarjetas y los hábitos visibles.
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
  const alias = useSocial((s) => s.profile?.alias);
  const bannerItem = useCatalogItem(useSocial((s) => s.profile?.banner_item));
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
    let url: string;
    try {
      url = await imageFileToAvatar(file);
      updateSettings({ avatarDataUrl: url });
      playSound.pop();
      showToast('Foto de perfil actualizada', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo usar esa imagen', 'error');
      setUploading(false);
      return;
    }
    // Con perfil público, la nueva foto también se publica
    try {
      await syncPublicAvatar(url);
    } catch (err) {
      reportSocialError(err, showToast, 'No se pudo actualizar la foto de tu perfil público');
    } finally {
      setUploading(false);
    }
  };

  const onRemovePhoto = async () => {
    updateSettings({ avatarDataUrl: undefined });
    playSound.delete();
    setUploading(true);
    try {
      await syncPublicAvatar(undefined);
    } catch (err) {
      reportSocialError(err, showToast, 'No se pudo quitar la foto de tu perfil público');
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
        <ProfileBanner banner={cosmeticOf(bannerItem)} />
        <div className="profile-hero-body">
          <MyAvatar size={96} />
          <div className="profile-hero-name">
            <h1>{name.trim() || 'Sin nombre'}</h1>
            {alias && <p className="profile-hero-alias">@{alias}</p>}
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
              <button type="button" className="btn btn-ghost sm" onClick={() => void onRemovePhoto()} disabled={uploading}>
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

      <PublicProfileCard />
    </div>
  );
};
