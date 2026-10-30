import React from 'react';
import { useStore } from '@/store/useStore';
import { assetUrl } from '@/social/api';
import { personName } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import type { BannerColor, CatalogItem, CatalogKind } from '@/social/types';
import { ProfileBanner, RankCard, cosmeticOf } from '@/components/social/Identity';
import { Avatar, MyAvatar, useMyAvatarSrc } from './Avatar';
import './profile.css';

/** La foto de la persona: la del dispositivo (o su foto por defecto) y, si no hay, la publicada */
export function useMyPhoto(): string | undefined {
  const local = useMyAvatarSrc();
  const path = useSocial((s) => s.profile?.avatar_path);
  return local || assetUrl('avatars', path);
}

/**
 * Vista previa de un cosmético con la cara de la persona (selector del perfil y tienda).
 * `item` vacío = «Ninguno» (lo que se ve sin cosmético; en los banners, el degradado del color elegido).
 * Las imágenes las dibujan los componentes de identidad, así lo animado solo se reproduce en pantalla.
 */
export const CosmeticPreview: React.FC<{
  kind: CatalogKind;
  item?: CatalogItem | null;
  size?: 'sm' | 'md';
  /** Color del banner por defecto (sin elegir: el del perfil) */
  bannerColor?: BannerColor | null;
}> = ({ kind, item, size = 'md', bannerColor }) => {
  const photo = useMyPhoto();
  const userName = useStore((s) => s.settings.userName);
  const profile = useSocial((s) => s.profile);
  const name = personName({ alias: profile?.alias, display_name: profile?.display_name || userName });
  const cosmetic = cosmeticOf(item);

  if (kind === 'banner') {
    return <ProfileBanner banner={cosmetic} color={bannerColor === undefined ? profile?.banner_color : bannerColor} className={`cos-prev-banner ${size}`} />;
  }
  if (kind === 'frame') {
    return (
      <span className={`cos-prev-frame ${size}`}>
        <Avatar src={photo} name={name} size={size === 'sm' ? 48 : 64} frame={cosmetic} />
      </span>
    );
  }
  if (kind === 'card') {
    return (
      <RankCard card={cosmetic} className={`cos-prev-card ${size}`}>
        <MyAvatar size={size === 'sm' ? 24 : 30} />
        <span className="cos-prev-card-name">{name}</span>
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
