import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { BadgeCheck, Check, Coins, Lock, Palette, ShieldCheck, Sparkles, UserPlus } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { triggerRewardCelebration } from '@/components/ui/RewardCelebrationOverlay';
import { BanScreen } from '@/components/social/BanScreen';
import { CosmeticPreview } from '@/components/profile/CosmeticPreview';
import { reportSocialError } from '@/components/profile/publicProfile';
import { purchaseItem, socialAvailable, updateProfile, type ProfilePatch } from '@/social/api';
import { myUserId } from '@/social/runtime';
import { KIND_LABEL, RARITY } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import type { CatalogItem, CatalogKind } from '@/social/types';
import { playSound } from '@/lib/sound';
import '@/components/social/social.css';
import './cosmetics.css';

/**
 * PERSONALIZACIÓN (docs/plan-social.md, F7)
 * Banners, marcos, tarjetas de ranking y recompensas del creador. Se pagan con el saldo verificado: el servidor cobra
 * (`purchase_item`) y comprueba que tengas lo que equipas (profiles_guard). Lo animado solo se reproduce en pantalla.
 */

const TABS: { kind: CatalogKind; label: string }[] = [
  { kind: 'banner', label: 'Banners' },
  { kind: 'frame', label: 'Marcos' },
  { kind: 'card', label: 'Tarjetas' },
  { kind: 'reward', label: 'Recompensas' },
];

const FIELD: Record<Exclude<CatalogKind, 'reward'>, 'banner_item' | 'frame_item' | 'card_item'> = {
  banner: 'banner_item',
  frame: 'frame_item',
  card: 'card_item',
};

const Head: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div className="row-between shop-section-head">
    <div className="shop-section-title">
      <Palette size={17} aria-hidden="true" /> Personalización
    </div>
    {children}
  </div>
);

export const CosmeticsShop: React.FC = () => {
  const { available, profile, ban, catalog, inventory, serverBalance } = useSocial(
    useShallow((s) => ({
      available: s.available, profile: s.profile, ban: s.ban, catalog: s.catalog, inventory: s.inventory, serverBalance: s.serverBalance,
    })),
  );
  const { showToast } = useToast();
  const [tab, setTab] = useState<CatalogKind>('banner');
  const [toBuy, setToBuy] = useState<CatalogItem | null>(null);
  const [toEquip, setToEquip] = useState<CatalogItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const owned = useMemo(() => new Set(inventory), [inventory]);
  // Lo que está a la venta y lo retirado que ya tienes
  const items = useMemo(
    () => catalog.filter((c) => c.kind === tab && (c.status === 'published' || (c.status === 'retired' && owned.has(c.id)))),
    [catalog, tab, owned],
  );

  // Sin servidor configurado no hay tienda de cosméticos (la app funciona solo en local)
  if (!socialAvailable()) return null;

  if (!available || !profile) {
    return (
      <section className="stack" style={{ gap: 14 }} aria-label="Personalización">
        <Head />
        <div className="card social-cta">
          <div>
            <div className="card-title">Banners, marcos y tarjetas para tu perfil</div>
            <p className="card-sub" style={{ marginTop: 4 }}>
              {available
                ? 'Los cosméticos se compran con monedas verificadas por el servidor y se ven en tu perfil público y en las clasificaciones. Crea tu perfil público para empezar.'
                : 'La comunidad todavía no está activada en el servidor. Cuando se active, podrás comprar cosméticos con monedas verificadas y lucirlos en tu perfil público y en las clasificaciones.'}
            </p>
          </div>
          {available && (
            <Link to="/perfil" className="btn btn-primary sm">
              <UserPlus size={15} aria-hidden="true" /> Crear mi perfil público
            </Link>
          )}
        </div>
      </section>
    );
  }

  const balance = serverBalance ?? 0;
  const locked = Boolean(ban);

  const equip = async (item: CatalogItem, on: boolean) => {
    if (item.kind === 'reward') return;
    const uid = myUserId();
    if (!uid) return;
    setBusyId(item.id);
    try {
      const patch: ProfilePatch = { [FIELD[item.kind]]: on ? item.id : null };
      const row = await updateProfile(uid, patch);
      useSocial.getState().set({ profile: row });
      playSound.pop();
      showToast(on ? `«${item.name}» equipado` : `Quitaste «${item.name}»`, 'success');
    } catch (err) {
      reportSocialError(err, showToast, 'No se pudo cambiar el cosmético');
    } finally {
      setBusyId(null);
    }
  };

  const buy = async (item: CatalogItem) => {
    setBusyId(item.id);
    try {
      const res = await purchaseItem(item.id);
      // El cobro ya está en el servidor: se refleja en el saldo del dispositivo con el mismo id del movimiento
      useStore.getState().mergeServerLedger([
        { id: res.ledger_id, amount: -Number(res.price ?? item.price), kind: 'purchase', ref: `item:${item.id}`, note: item.name, created_at: new Date().toISOString() },
      ]);
      const st = useSocial.getState();
      st.set({ serverBalance: Number(res.balance), inventory: st.inventory.includes(item.id) ? st.inventory : [...st.inventory, item.id] });
      triggerRewardCelebration({
        name: item.name,
        icon: '🎨',
        cost: Number(res.price ?? item.price),
        kicker: '¡Nuevo cosmético!',
        subtitle: 'Ya puedes equiparlo en tu perfil.',
      });
      if (item.kind !== 'reward') setToEquip(item);
    } catch (err) {
      reportSocialError(err, showToast, 'No se pudo completar la compra');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="stack" style={{ gap: 14 }} aria-label="Personalización">
      <Head>
        <span className="badge warning cos-balance" title="Saldo que guarda el servidor">
          <BadgeCheck size={13} aria-hidden="true" /> Saldo verificado: {serverBalance === null ? '…' : balance.toLocaleString('es')} monedas
        </span>
      </Head>
      <p className="cos-intro">
        <ShieldCheck size={14} aria-hidden="true" /> Las compras de cosméticos las cobra el servidor con tu saldo verificado, así se ven
        igual en tu perfil público, en las clasificaciones y en todos tus dispositivos.
      </p>

      {locked && <BanScreen compact />}

      <div className="segmented cos-tabs" role="tablist" aria-label="Tipo de cosmético">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            role="tab"
            id={`cos-tab-${t.kind}`}
            aria-selected={tab === t.kind}
            aria-controls="cos-panel"
            className={tab === t.kind ? 'active' : ''}
            onClick={() => {
              setTab(t.kind);
              playSound.click();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="cos-panel" role="tabpanel" aria-labelledby={`cos-tab-${tab}`}>
        {items.length === 0 ? (
          <p className="cos-empty">Todavía no hay {KIND_LABEL[tab].many.toLowerCase()} en la tienda. ¡Vuelve pronto!</p>
        ) : (
          <div className={`cos-grid kind-${tab}`}>
            {items.map((item) => {
              const mine = owned.has(item.id);
              const equipped = item.kind !== 'reward' && profile[FIELD[item.kind]] === item.id;
              const busy = busyId === item.id;
              const rarity = RARITY[item.rarity];
              return (
                <article key={item.id} className={`cos-item ${equipped ? 'is-equipped' : ''} ${mine ? 'is-owned' : ''}`}>
                  <div className="cos-item-preview">
                    <CosmeticPreview kind={item.kind} item={item} />
                  </div>
                  <div className="cos-item-body">
                    <div className="cos-item-name" title={item.name}>
                      {item.name}
                    </div>
                    <div className="cos-item-tags">
                      <span className="rarity" style={{ ['--r' as string]: rarity.color }}>
                        {rarity.label}
                      </span>
                      {item.animated && (
                        <span className="badge accent">
                          <Sparkles aria-hidden="true" /> Animado
                        </span>
                      )}
                      {item.status === 'retired' && <span className="badge">Retirado</span>}
                    </div>
                    {item.description && <p className="cos-item-desc">{item.description}</p>}
                  </div>
                  <div className="cos-item-foot">
                    {mine ? (
                      <span className="cos-owned">
                        <Check size={13} strokeWidth={3} aria-hidden="true" /> Tuyo
                      </span>
                    ) : (
                      <span className="cos-price">
                        <Coins size={16} aria-hidden="true" /> {item.price.toLocaleString('es')}
                        <small>monedas</small>
                      </span>
                    )}
                    {!mine ? (
                      <button
                        type="button"
                        className={`btn sm ${balance >= item.price ? 'shop-buy' : 'btn-secondary'}`}
                        disabled={locked || busy || serverBalance === null || balance < item.price}
                        onClick={() => setToBuy(item)}
                      >
                        {/* Sin saldo verificado todavía no se sabe cuánto falta */}
                        {balance >= item.price || serverBalance === null ? (
                          'Comprar'
                        ) : (
                          <>
                            <Lock size={13} aria-hidden="true" /> Faltan {(item.price - balance).toLocaleString('es')}
                          </>
                        )}
                      </button>
                    ) : item.kind === 'reward' ? null : equipped ? (
                      <div className="cos-equipped-actions">
                        <span className="badge success">Equipado</span>
                        <button type="button" className="btn btn-ghost sm" disabled={locked || busy} onClick={() => void equip(item, false)}>
                          Quitar
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn btn-secondary sm" disabled={locked || busy} onClick={() => void equip(item, true)}>
                        Equipar
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={Boolean(toBuy)}
        onClose={() => setToBuy(null)}
        onConfirm={() => {
          if (toBuy) void buy(toBuy);
        }}
        title={`Comprar «${toBuy?.name ?? ''}»`}
        message={`¿Comprar ${toBuy ? KIND_LABEL[toBuy.kind].one.toLowerCase() : ''} «${toBuy?.name ?? ''}» por ${toBuy?.price ?? 0} monedas? Las cobra el servidor de tu saldo verificado (${balance} monedas).`}
        confirmLabel="Comprar"
        confirmVariant="primary"
        danger={false}
      />

      <ConfirmModal
        isOpen={Boolean(toEquip)}
        onClose={() => setToEquip(null)}
        onConfirm={() => {
          if (toEquip) void equip(toEquip, true);
        }}
        title="¿Equiparlo ahora?"
        message={`«${toEquip?.name ?? ''}» ya es tuyo. ¿Quieres usarlo ya en tu perfil público y en las clasificaciones?`}
        confirmLabel="Equipar"
        cancelText="Más tarde"
        confirmVariant="primary"
        danger={false}
      />
    </section>
  );
};
