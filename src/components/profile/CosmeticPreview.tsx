import React from 'react';
import { useStore } from '@/store/useStore';
import { assetUrl } from '@/social/api';
import { useSocial } from '@/social/useSocial';
import type { CatalogItem, CatalogKind } from '@/social/types';
import { ProfileBanner, RankCard, cosmeticOf } from '@/components/social/Identity';
import { Avatar, MyAvatar } from './Avatar';
import './profile.css';

/** La foto de la persona: la del dispositivo y, si no hay, la publicada */
export function useMyPhoto(): string | undefined {
  const local = useStore((s) => s.settings.avatarDataUrl);
  const path = useSocial((s) => s.profile?.avatar_path);
  return local || assetUrl('avatars', path);
}

/**
 * Vista previa de un cosmético con la cara de la persona (selector del perfil y tienda).
 * `item` vacío = «Ninguno» (lo que se ve sin cosmético). Las imágenes las dibujan los componentes de identidad,
 * así lo animado solo se reproduce en pantalla.
 */
export const CosmeticPreview: React.FC<{ kind: CatalogKind; item?: CatalogItem | null; size?: 'sm' | 'md' }> = ({ kind, item, size = 'md' }) => {
  const photo = useMyPhoto();
  const name = useStore((s) => s.settings.userName);
  const alias = useSocial((s) => s.profile?.alias);
  const cosmetic = cosmeticOf(item);

  if (kind === 'banner') return <ProfileBanner banner={cosmetic} className={`cos-prev-banner ${size}`} />;
  if (kind === 'frame') {
    return (
      <span className={`cos-prev-frame ${size}`}>
        <Avatar src={photo} name={name || alias} size={size === 'sm' ? 48 : 64} frame={cosmetic} />
      </span>
    );
  }
  if (kind === 'card') {
    return (
      <RankCard card={cosmetic} className={`cos-prev-card ${size}`}>
        <MyAvatar size={size === 'sm' ? 24 : 30} />
        <span className="cos-prev-card-name">@{alias || 'tu_alias'}</span>
        <span className="cos-prev-card-stat" aria-hidden="true">
          🔥 12
        </span>
      </RankCard>
    );
  }
  return (
    <span className={`cos-prev-reward ${size}`} aria-hidden="true">
      {item?.icon || '🎁'}
    </span>
  );
};
