import { useEffect, useState } from 'react';
import { aliasTaken, removeAvatarFiles, SocialError, updateProfile, uploadAvatar } from '@/social/api';
import { dataUrlToBlob, isWebp, photoToWebp, readBytes } from '@/social/images';
import { myUserId, refreshSocialStatus, rememberPublishedAvatar } from '@/social/runtime';
import { ALIAS_RE } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import { useStore } from '@/store/useStore';
import { defaultAvatarPath, effectivePreset, parseDefaultAvatarPath } from '@/lib/defaultAvatars';
import type { ToastType } from '@/components/ui/ToastContext';

/**
 * AYUDAS DEL PERFIL PÚBLICO (las usan /perfil, la bienvenida, Ajustes y la tienda de cosméticos)
 * El servidor decide todo (profiles_guard, purchase_item): aquí solo se adelantan los avisos para la interfaz.
 */

/** Los mismos alias reservados que comprueba profiles_guard */
const RESERVED = ['admin', 'administrador', 'creador', 'pilas', 'soporte', 'moderador', 'moderacion', 'pilo', 'pila', 'root', 'sistema', 'system', 'oficial'];

export type AliasStatus = 'empty' | 'same' | 'invalid' | 'reserved' | 'checking' | 'taken' | 'free' | 'error';

export const ALIAS_HINT: Record<AliasStatus, string> = {
  empty: 'De 3 a 20 letras minúsculas, números o «_».',
  same: 'Es tu alias actual.',
  invalid: 'De 3 a 20 letras minúsculas, números o «_».',
  reserved: 'Ese alias está reservado.',
  checking: 'Comprobando…',
  taken: 'Ese alias ya está en uso.',
  free: '¡Está libre!',
  error: 'No se pudo comprobar ahora. Se comprobará al guardar.',
};

/** Valida el alias y, con una espera de 400 ms, pregunta al servidor si está libre */
export function useAliasStatus(alias: string, current?: string | null): AliasStatus {
  const local: AliasStatus | null = !alias
    ? 'empty'
    : current && alias === current
      ? 'same'
      : !ALIAS_RE.test(alias)
        ? 'invalid'
        : RESERVED.includes(alias)
          ? 'reserved'
          : null;
  const [remote, setRemote] = useState<{ alias: string; status: AliasStatus } | null>(null);

  useEffect(() => {
    if (local) return;
    let active = true;
    const t = setTimeout(() => {
      aliasTaken(alias)
        .then((taken) => active && setRemote({ alias, status: taken ? 'taken' : 'free' }))
        .catch(() => active && setRemote({ alias, status: 'error' }));
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [alias, local]);

  if (local) return local;
  return remote?.alias === alias ? remote.status : 'checking';
}

/** Se puede guardar con este estado (si no se pudo comprobar, decide el servidor) */
export const aliasUsable = (s: AliasStatus) => s === 'free' || s === 'error' || s === 'same';

/** Muestra el error del servidor y, si es un veto, refresca el estado para mostrar el aviso */
export function reportSocialError(err: unknown, showToast: (msg: string, type?: ToastType) => void, fallback = 'No se pudo completar') {
  showToast(err instanceof Error && err.message ? err.message : fallback, 'error');
  if (err instanceof SocialError && err.banned) void refreshSocialStatus();
}

/** La foto guardada en el dispositivo → WebP listo para el bucket `avatars` (≤ 1 MB) */
export async function avatarBlobFrom(dataUrl: string): Promise<Blob> {
  const blob = await dataUrlToBlob(dataUrl);
  if (isWebp(await readBytes(blob)) && blob.size <= 1024 * 1024) return blob.type === 'image/webp' ? blob : new Blob([blob], { type: 'image/webp' });
  return photoToWebp(blob);
}

/**
 * Publica la foto del dispositivo en el perfil público o, sin foto (`undefined`), la foto por defecto que se ve
 * (`effectivePreset` → `default:N`). No hace nada sin perfil o con veto. El archivo anterior se borra sin esperar: si
 * falla, solo queda un archivo huérfano en tu carpeta. Las fotos por defecto no son archivos: no hay nada que borrar.
 * Recuerda en el dispositivo qué foto quedó publicada: si esto falla (sin conexión, sin perfil todavía), la capa pública
 * vuelve a intentarlo sola en el siguiente ciclo (social/runtime.ts).
 */
export async function syncPublicAvatar(dataUrl: string | undefined): Promise<boolean> {
  const { profile, available, ban } = useSocial.getState();
  const uid = myUserId();
  if (!profile || !available || ban || !uid) return false;
  const prev = profile.avatar_path;
  const uploaded = dataUrl ? await uploadAvatar(uid, await avatarBlobFrom(dataUrl)) : null;
  const path = uploaded ?? defaultAvatarPath(effectivePreset(useStore.getState().settings.avatarPreset, uid));
  if (path !== prev) {
    try {
      const row = await updateProfile(uid, { avatar_path: path });
      useSocial.getState().set({ profile: row });
    } catch (err) {
      if (uploaded) void removeAvatarFiles([uploaded]).catch(() => undefined);
      throw err;
    }
    if (prev && !parseDefaultAvatarPath(prev)) void removeAvatarFiles([prev]).catch(() => undefined);
  }
  await rememberPublishedAvatar(uid, dataUrl).catch(() => undefined);
  return true;
}
