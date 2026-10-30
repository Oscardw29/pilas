import React, { useRef } from 'react';
import { useStore } from '@/store/useStore';
import { useSession } from '@/store/useSession';
import { assetUrl } from '@/social/api';
import { defaultAvatarSrc, effectivePreset, type DefaultAvatarId } from '@/lib/defaultAvatars';
import { personName } from '@/social/texts';
import { useCatalogItem, useSocial } from '@/social/useSocial';
import { useInView } from '@/social/useInView';
import type { Cosmetic } from '@/social/types';
import './profile.css';

/** Por debajo de este tamaño los marcos se dibujan con su fotograma fijo (un WebP animado por fila pesa demasiado) */
export const STATIC_BELOW_PX = 40;

/**
 * Elige la imagen de un cosmético: la animada solo si se ve en pantalla y el tamaño lo merece; si no, el fotograma fijo.
 */
export function useCosmeticSrc(c: Cosmetic | null | undefined, size: number, ref: React.RefObject<Element | null>) {
  const animated = Boolean(c?.animated && c.path && size >= STATIC_BELOW_PX);
  const inView = useInView(ref, animated);
  if (!c?.path) return undefined;
  if (!c.animated) return assetUrl('catalog', c.path);
  return assetUrl('catalog', animated && inView ? c.path : (c.thumb ?? c.path));
}

/**
 * Foto de perfil con su marco. Es el único componente que la dibuja: los marcos (normales, animados o personalizados)
 * se ven así en todos los sitios donde aparece la persona (ver docs/plan-social.md, «Componentes de identidad»).
 * Sin foto se muestran las iniciales sobre un degradado.
 */
export const Avatar: React.FC<{ src?: string; name?: string; size?: number; className?: string; frame?: Cosmetic | null }> = ({
  src,
  name = '',
  size = 36,
  className = '',
  frame,
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const frameSrc = useCosmeticSrc(frame, size, ref);
  const initials =
    name
      .trim()
      .replace(/^@/, '')
      .split(/[\s_]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?';
  const face = (
    <span
      ref={frameSrc ? undefined : ref}
      className={`avatar ${frameSrc ? '' : className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" width={size} height={size} draggable={false} loading="lazy" decoding="async" /> : initials}
    </span>
  );
  if (!frameSrc) return face;
  return (
    <span ref={ref} className={`avatar-framed ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      {face}
      <img className="avatar-frame" src={frameSrc} alt="" draggable={false} decoding="async" />
    </span>
  );
};

/** Foto por defecto que se ve: la elegida o, sin elegir, la que corresponde a la cuenta (la misma en todos los dispositivos) */
export const useMyPreset = (): DefaultAvatarId => {
  const preset = useStore((s) => s.settings.avatarPreset);
  const uid = useSession((s) => s.user?.id ?? '');
  return effectivePreset(preset, uid);
};

/** Foto propia: la subida o, si no hay, la foto por defecto */
export const useMyAvatarSrc = () => {
  const photo = useStore((s) => s.settings.avatarDataUrl);
  const preset = useMyPreset();
  return photo || defaultAvatarSrc(preset);
};

/** Avatar de la persona con sesión iniciada (con el marco equipado en su perfil público) */
export const MyAvatar: React.FC<{ size?: number; className?: string }> = (props) => {
  const src = useMyAvatarSrc();
  const name = useStore((s) => s.settings.userName);
  const frameId = useSocial((s) => s.profile?.frame_item);
  const alias = useSocial((s) => s.profile?.alias);
  const item = useCatalogItem(frameId);
  const frame = item ? { path: item.asset_path, thumb: item.thumb_path, animated: item.animated } : null;
  return <Avatar src={src} name={alias || name} frame={frame} {...props} />;
};

/** Avatar de otra persona a partir de lo que devuelve el servidor */
export const PersonAvatar: React.FC<{
  person: {
    alias: string | null;
    display_name?: string | null;
    avatar_path: string | null;
    frame_path?: string | null;
    frame_thumb?: string | null;
    frame_animated?: boolean | null;
  };
  size?: number;
  className?: string;
}> = ({ person, size = 36, className }) => {
  const frame = person.frame_path ? { path: person.frame_path, thumb: person.frame_thumb ?? null, animated: Boolean(person.frame_animated ?? person.frame_thumb) } : null;
  return <Avatar src={assetUrl('avatars', person.avatar_path)} name={personName(person)} size={size} className={className} frame={frame} />;
};

/**
 * Convierte una imagen elegida por la persona en una foto de perfil cuadrada (recorte centrado), 256×256, WebP.
 * Se hace en el dispositivo: la imagen original no se guarda en ningún sitio.
 */
export async function imageFileToAvatar(file: File, size = 256): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  if (file.size > 15 * 1024 * 1024) throw new Error('La imagen pesa demasiado (máximo 15 MB).');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('No se pudo leer la imagen.');
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo procesar la imagen.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const url = canvas.toDataURL('image/webp', 0.85);
  // Navegadores sin codificador WebP devuelven PNG: se acepta igual (sigue siendo pequeño a 256 px)
  return url;
}
