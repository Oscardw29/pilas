import React from 'react';
import { useStore } from '@/store/useStore';
import './profile.css';

/**
 * Foto de perfil. Es el único componente que la dibuja: cuando lleguen los marcos (animados o no), se añaden aquí
 * y se ven en todos los sitios donde aparece la persona (ver docs/plan-social.md, «Componentes de identidad»).
 * Sin foto se muestran las iniciales sobre un degradado.
 */
export const Avatar: React.FC<{ src?: string; name?: string; size?: number; className?: string }> = ({
  src,
  name = '',
  size = 36,
  className = '',
}) => {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?';
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {src ? <img src={src} alt="" width={size} height={size} draggable={false} /> : initials}
    </span>
  );
};

/** Avatar de la persona con sesión iniciada */
export const MyAvatar: React.FC<{ size?: number; className?: string }> = (props) => {
  const src = useStore((s) => s.settings.avatarDataUrl);
  const name = useStore((s) => s.settings.userName);
  return <Avatar src={src} name={name} {...props} />;
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
