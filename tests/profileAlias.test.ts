import { describe, expect, it } from 'vitest';
import { draftChanges, draftFrom } from '@/components/profile/ProfileEditor';
import type { ProfileRow } from '@/social/types';
import type { Settings } from '@/types';

const settings = {} as Settings;
const profile = { alias: 'ana', bio: '', banner_item: null, frame_item: null, card_item: null, cards: [], featured_achievements: [] } as unknown as ProfileRow;
const noAlias = { ...profile, alias: null } as ProfileRow;

describe('alias en el modo edición del perfil', () => {
  it('sin tocarlo no hay cambios', () => {
    expect(draftChanges(draftFrom(settings, profile, []), settings, profile, []).dirty).toBe(false);
    expect(draftChanges(draftFrom(settings, noAlias, []), settings, noAlias, []).dirty).toBe(false);
  });

  it('un alias nuevo o vacío va en el parche', () => {
    const draft = draftFrom(settings, profile, []);
    const renamed = draftChanges({ ...draft, alias: 'ana_2' }, settings, profile, []);
    expect(renamed.patch.alias).toBe('ana_2');
    expect(renamed.dirty).toBe(true);
    // Vacío = quitarlo (null: la columna es única y no admite cadenas vacías repetidas)
    expect(draftChanges({ ...draft, alias: '' }, settings, profile, []).patch.alias).toBeNull();
  });

  it('sin perfil público el alias no se envía', () => {
    const draft = draftFrom(settings, profile, []);
    expect(draftChanges({ ...draft, alias: 'otro' }, settings, null, []).patch.alias).toBeUndefined();
  });
});
