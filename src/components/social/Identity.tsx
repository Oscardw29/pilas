import React, { useRef } from 'react';
import { useCosmeticSrc } from '@/components/profile/Avatar';
import type { CatalogItem, Cosmetic } from '@/social/types';
import './social.css';

/**
 * COMPONENTES DE IDENTIDAD (docs/plan-social.md): el avatar con marco vive en components/profile/Avatar.tsx;
 * aquí están el banner del perfil y la tarjeta de ranking. Toda la app usa estos mismos componentes, así lo que
 * alguien compra (normal, animado o personalizado) se ve igual en todos los sitios.
 */

export const cosmeticOf = (item: Pick<CatalogItem, 'asset_path' | 'thumb_path' | 'animated'> | null | undefined): Cosmetic | null =>
  item?.asset_path ? { path: item.asset_path, thumb: item.thumb_path, animated: item.animated } : null;

/** Banner del perfil (propio, público y vista previa). Sin banner: el degradado de la marca */
export const ProfileBanner: React.FC<{ banner?: Cosmetic | null; className?: string; children?: React.ReactNode }> = ({
  banner,
  className = '',
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // El banner siempre es grande: se anima mientras se ve
  const src = useCosmeticSrc(banner, 999, ref);
  return (
    <div ref={ref} className={`profile-banner ${src ? 'has-image' : ''} ${className}`}>
      {src && <img src={src} alt="" draggable={false} decoding="async" />}
      {children}
    </div>
  );
};

/**
 * Tarjeta de ranking: el fondo de la fila de la persona en las clasificaciones y en las listas de liga.
 * El contenido va encima, con un velo para que se lea sobre cualquier imagen.
 */
export const RankCard: React.FC<{
  card?: Cosmetic | null;
  highlight?: boolean;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  as?: 'div' | 'li' | 'button';
}> = ({ card, highlight, className = '', children, onClick, as = 'div' }) => {
  const ref = useRef<HTMLElement>(null);
  const src = useCosmeticSrc(card, 999, ref);
  const Tag = as as 'div';
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`rank-card ${src ? 'has-image' : ''} ${highlight ? 'is-me' : ''} ${onClick ? 'is-clickable' : ''} ${className}`}
      onClick={onClick}
      {...(as === 'button' ? { type: 'button' } : {})}
    >
      {src && <img className="rank-card-bg" src={src} alt="" draggable={false} decoding="async" loading="lazy" />}
      <div className="rank-card-body">{children}</div>
    </Tag>
  );
};
