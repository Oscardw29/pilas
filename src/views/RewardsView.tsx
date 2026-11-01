import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useDemoMode, useStore } from '../store/useStore';
import { Reward, Redemption } from '../types';
import { levelFromXp } from '../lib/metrics';
import { useEconomy } from '../store/useEconomy';
import { boostOffer, freezeOffer } from '../lib/economy';
import { ECONOMY } from '../lib/economyRules';
import { Coins, Plus, Gift, Trash2, Lock, Edit3, Shield, ShieldCheck, Snowflake, Check, ReceiptText, Store, Zap, Hourglass, ListChecks, FlaskConical } from 'lucide-react';
import { RewardModal } from '../components/modals/RewardModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useToast } from '../components/ui/ToastContext';
import { playSound } from '../lib/sound';
import { triggerRewardCelebration } from '../components/ui/RewardCelebrationOverlay';
import { CoachAvatar } from '../components/coach/CoachAvatar';
import { useCoachPersona } from '../components/coach/coachPersona';
import { CashRegister, ShopAwning, ShopBackShelf } from '../components/shop/ShopArt';
import { CosmeticsShop } from '../components/shop/CosmeticsShop';
import { RewardsBulkEditor } from '../components/shop/RewardsBulkEditor';
import { purchaseBoost, SocialError } from '../social/api';
import { refreshSocialStatus } from '../social/runtime';
import { useSocial } from '../social/useSocial';
import '../components/shop/shop.css';

/** «3 h 20 min» */
function formatLeft(ms: number) {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** Colores de la caja de cada producto (rotan por el catálogo) */
const BOX_COLORS = [
  { face: '#8b5cf6', lip: '#6d28d9' },
  { face: '#f472b6', lip: '#be185d' },
  { face: '#14b8a6', lip: '#0f766e' },
  { face: '#fb923c', lip: '#c2410c' },
  { face: '#60a5fa', lip: '#1d4ed8' },
  { face: '#a3e635', lip: '#4d7c0f' },
];

export const RewardsView: React.FC = () => {
  const { rewards, redemptions, redeem, deleteReward, hasStreakFreeze, buyStreakFreeze, buyXpBoost } = useStore(useShallow((s) => ({ rewards: s.rewards, redemptions: s.redemptions, redeem: s.redeem, deleteReward: s.deleteReward, hasStreakFreeze: s.hasStreakFreeze, buyStreakFreeze: s.buyStreakFreeze, buyXpBoost: s.buyXpBoost })));
  const econData = useStore(
    useShallow((s) => ({
      habits: s.habits, logs: s.logs, pointEvents: s.pointEvents, redemptions: s.redemptions, streakFreezes: s.streakFreezes,
      xpBoosts: s.xpBoosts, settings: s.settings, hasStreakFreeze: s.hasStreakFreeze,
    })),
  );
  // Reloj de la tienda: el tiempo restante del multiplicador y su espera se actualizan solos
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const freeze = useMemo(() => freezeOffer(econData, new Date(now)), [econData, now]);
  const boost = useMemo(() => boostOffer(econData, now), [econData, now]);
  const { showToast } = useToast();
  const persona = useCoachPersona();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [rewardToRedeem, setRewardToRedeem] = useState<Reward | 'streak_freeze' | 'xp_boost' | null>(null);
  const [rewardIdToDelete, setRewardIdToDelete] = useState<string | null>(null);
  /** Modo «Editar varias»: la estantería se cambia por la tabla editable de los premios propios */
  const [bulkEditing, setBulkEditing] = useState(false);
  // Con datos de demostración no se compra nada que cobre el servidor (el multiplicador ni los cosméticos)
  const demoMode = useDemoMode();
  /** El tendero celebra cada canje */
  const [cheerKey, setCheerKey] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (!cheerKey) return;
    setCelebrating(true);
    const t = setTimeout(() => setCelebrating(false), 6000);
    return () => clearTimeout(t);
  }, [cheerKey]);

  const pts = useEconomy();
  const levelInfo = levelFromXp(pts.xpTotal);

  // Lo que dice el tendero según el saldo
  const shopkeeperLine = useMemo(() => {
    if (celebrating) return '¡Buena elección! Disfrútalo, te lo ganaste 🎉';
    const affordable = rewards.filter((r) => r.cost <= pts.balance).length + (!freeze.blocked && pts.balance >= freeze.price ? 1 : 0);
    if (affordable > 0) return `¡Hola! Con tus ${Math.round(pts.balance)} pts te alcanza para ${affordable} ${affordable === 1 ? 'premio' : 'premios'}.`;
    const next = [...rewards].sort((a, b) => a.cost - b.cost).find((r) => r.cost > pts.balance);
    if (next) return `Te faltan ${Math.ceil(next.cost - pts.balance)} pts para «${next.name}». ¡Tú puedes!`;
    return '¡Hola! Añade premios a la estantería y ve por ellos.';
  }, [celebrating, rewards, pts.balance, freeze.blocked, freeze.price]);

  // El bocadillo se escribe letra a letra cada vez que cambia la frase
  const [typed, setTyped] = useState(0);
  const lineChars = Array.from(shopkeeperLine);
  useEffect(() => setTyped(0), [shopkeeperLine]);
  useEffect(() => {
    if (typed >= lineChars.length) return;
    const t = setTimeout(() => setTyped((n) => n + 1), typed === 0 ? 450 : 30);
    return () => clearTimeout(t);
  }, [typed, lineChars.length]);

  const socialBoost = useSocial((s) => Boolean(s.profile && s.available && !s.ban));
  const serverBalance = useSocial((s) => s.serverBalance);

  const handleConfirmRedeem = () => {
    if (!rewardToRedeem) return;

    if (rewardToRedeem === 'xp_boost') {
      if (demoMode) {
        showToast('No disponible con datos de demostración', 'warning');
        setRewardToRedeem(null);
        return;
      }
      const cost = boost.price;
      const celebrateBoost = (paid: number) => {
        triggerRewardCelebration({ name: 'Multiplicador 1.5× de XP', icon: '⚡', cost: paid, isFreeze: false });
        setCheerKey((k) => k + 1);
        showToast(`¡Multiplicador activo! Durante ${ECONOMY.boostHours} h, cada hábito que completes da 1.5× de XP.`, 'reward');
      };
      // Con perfil público lo cobra el servidor (comprueba la espera de 24 h y el límite del mes)
      const social = useSocial.getState();
      if (social.profile && social.available && !social.ban) {
        void purchaseBoost()
          .then((res) => {
            buyXpBoost({ id: res.id, startedAt: res.started_at, endsAt: res.ends_at, price: res.price, ledgerId: res.ledger_id });
            useSocial.getState().set({ serverBalance: Number(res.balance) });
            celebrateBoost(res.price);
          })
          .catch((err: unknown) => {
            showToast(err instanceof Error && err.message ? err.message : 'No se pudo activar el multiplicador', 'warning');
            if (err instanceof SocialError && err.banned) void refreshSocialStatus();
          });
      } else if (buyXpBoost()) {
        celebrateBoost(cost);
      } else {
        showToast('Ahora no se puede comprar el multiplicador', 'warning');
      }
    } else if (rewardToRedeem === 'streak_freeze') {
      const cost = freeze.price;
      const ok = buyStreakFreeze();
      if (ok) {
        // El overlay del cofre reproduce el sonido y el confeti sincronizados con la apertura
        triggerRewardCelebration({
          name: 'Protector de Racha',
          icon: '❄️',
          cost,
          isFreeze: true,
        });
        setCheerKey((k) => k + 1);
        showToast('¡Protector de racha adquirido! Tu racha quedará a salvo si no completas hábitos un día.', 'success');
      } else {
        showToast('No tienes puntos suficientes', 'warning');
      }
    } else {
      const ok = redeem(rewardToRedeem.id);
      if (ok) {
        triggerRewardCelebration({
          name: rewardToRedeem.name,
          icon: rewardToRedeem.icon,
          cost: rewardToRedeem.cost,
          isFreeze: false,
        });
        setCheerKey((k) => k + 1);
        showToast(`¡Canje exitoso! Disfruta «${rewardToRedeem.name}».`, 'reward');
      } else {
        showToast('No tienes puntos suficientes', 'warning');
      }
    }
    setRewardToRedeem(null);
  };

  const handleConfirmDelete = () => {
    if (!rewardIdToDelete) return;
    deleteReward(rewardIdToDelete);
    playSound.delete();
    setRewardIdToDelete(null);
    showToast('Recompensa eliminada.', 'info');
  };

  const openNew = () => {
    setEditingReward(null);
    setIsModalOpen(true);
  };

  const canAffordFreeze = pts.balance >= freeze.price;
  // Con perfil público el multiplicador lo cobra el servidor: cuenta su saldo verificado
  const boostBalance = socialBoost && serverBalance !== null ? Math.min(pts.balance, serverBalance) : pts.balance;
  const canBuyBoost = !demoMode && !boost.blocked && boostBalance >= boost.price;

  return (
    <div className="stack fade-up shop-page">
      {/* FACHADA: carpa, el tendero detrás del mostrador y la caja con el saldo */}
      <section className="shop-front">
        <ShopAwning />

        <div className="shop-front-body">
          <div className="shop-front-copy">
            <p className="shop-eyebrow">
              <Store size={14} aria-hidden="true" /> Gamificación y canjes
            </p>
            <h1>Tienda de recompensas</h1>
            <p className="shop-front-sub">
              Canjea las monedas de tus hábitos por premios reales que disfrutes. La XP no se gasta: mide tu constancia.
            </p>

            <div className="shop-stats">
              <div className="shop-stat">
                <div className="stat-top">
                  <span className="stat-label">Puntos disponibles</span>
                  <span className="badge warning">Canjeable</span>
                </div>
                <div className="stat-value shop-balance">
                  <Coins size={20} aria-hidden="true" /> {Math.round(pts.balance)} <small>pts</small>
                </div>
                <div className="row-between xs muted">
                  <span>Ganados: +{Math.round(pts.earned)}</span>
                  <span>Canjeados: −{Math.round(pts.spent)}</span>
                </div>
              </div>

              <div className="shop-stat">
                <div className="stat-top">
                  <span className="stat-label">Nivel de constancia</span>
                  <span className="badge accent">Nivel {levelInfo.level}</span>
                </div>
                <div className="stat-value">
                  {Math.round(pts.xpTotal)} <small>XP</small>
                </div>
                <div className="progress thin">
                  <div style={{ width: `${Math.round(levelInfo.progress * 100)}%` }} />
                </div>
                <div className="row-between xs muted">
                  <span>{Math.round(levelInfo.progress * 100)}% hacia nivel {levelInfo.level + 1}</span>
                  <span>Faltan {Math.ceil(levelInfo.xpForNext - levelInfo.xpInLevel)} XP</span>
                </div>
              </div>
            </div>
          </div>

          <div className="shop-front-scene" aria-hidden="true">
            <ShopBackShelf />
            {/* El bocadillo ocupa solo el hueco libre a la izquierda del tendero (no invade el texto) */}
            <div className="shop-bubble">
              {lineChars.slice(0, typed).join('')}
              <span className="shop-bubble-ghost">{lineChars.slice(typed).join('')}</span>
            </div>
            <div className="shop-keeper">
              <CoachAvatar
                gender={persona.gender}
                crop="bust"
                size={206}
                outfit="shop"
                expression={celebrating ? 'excited' : 'happy'}
                // Abre la tienda con su cartel y entrega el regalo en cada canje
                gesture={cheerKey ? 'gift' : 'sign'}
                gestureKey={cheerKey || 1}
              />
            </div>
            <div className="shop-counter">
              <CashRegister />
            </div>
          </div>
        </div>
      </section>

      {/* ESTANTERÍA DE PREMIOS */}
      <div className="stack" style={{ gap: 14 }}>
        <div className="row-between shop-section-head">
          <div className="shop-section-title">
            <Gift size={17} aria-hidden="true" /> Estantería de premios
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="badge accent">{rewards.length + 2} recompensas</span>
            {!bulkEditing && rewards.length > 0 && (
              <button type="button" className="btn btn-secondary sm" onClick={() => setBulkEditing(true)}>
                <ListChecks size={15} aria-hidden="true" /> Editar varias
              </button>
            )}
            {!bulkEditing && (
              <button type="button" className="btn btn-primary sm" onClick={openNew}>
                <Plus size={15} /> Nuevo premio
              </button>
            )}
          </div>
        </div>

        {bulkEditing ? (
          <RewardsBulkEditor onClose={() => setBulkEditing(false)} />
        ) : (
          <div className="shop-shelves">
            {/* Recompensa permanente: Protector de racha */}
            <article className={`shop-item freeze${hasStreakFreeze ? ' owned' : ''}`}>
              <div className="shop-item-display">
                <span className="shop-box" style={{ ['--box' as string]: '#38bdf8', ['--box-lip' as string]: '#0284c7' }}>
                  <Shield size={28} aria-hidden="true" />
                </span>
                <span className="badge shop-item-flag" style={{ background: 'color-mix(in srgb, var(--info) 16%, transparent)', color: 'var(--info)' }}>
                  {hasStreakFreeze ? (
                    <>
                      <Snowflake size={11} aria-hidden="true" /> Protección activa
                    </>
                  ) : (
                    'Permanente'
                  )}
                </span>
              </div>
              <div className="shop-item-body">
                <div className="shop-item-name" style={{ color: 'var(--info)' }}>
                  Protector de racha (1 día)
                </div>
                <p className="shop-item-desc">
                  Si un día no haces hábitos, tu racha se congela en azul en vez de romperse (ese día no da monedas ni XP). Máximo 1
                  guardado · {freeze.boughtThisMonth}/{freeze.maxPerMonth} este mes. El precio sigue tu ritmo: unos 2 días de esfuerzo.
                </p>
              </div>
              <div className="shop-item-foot">
                <div className="reward-price" style={{ color: 'var(--info)' }}>
                  <Coins size={18} aria-hidden="true" />
                  <span>{Math.round(freeze.price)}</span>
                  <small className="muted" style={{ fontSize: 12 }}>
                    pts
                  </small>
                </div>
                {hasStreakFreeze ? (
                  <button type="button" className="btn sm btn-secondary shop-owned" disabled>
                    <ShieldCheck size={14} aria-hidden="true" /> Activo (1/1)
                  </button>
                ) : freeze.blocked === 'month-limit' ? (
                  <button type="button" className="btn sm btn-secondary" disabled>
                    <Lock size={13} /> Límite del mes
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`btn sm ${canAffordFreeze ? 'shop-buy-ice' : 'btn-secondary'}`}
                    disabled={!canAffordFreeze}
                    onClick={() => setRewardToRedeem('streak_freeze')}
                  >
                    {canAffordFreeze ? (
                      <>
                        <Gift size={14} /> Canjear escudo
                      </>
                    ) : (
                      <>
                        <Lock size={13} /> Faltan {Math.ceil(freeze.price - pts.balance)}
                      </>
                    )}
                  </button>
                )}
              </div>
              {hasStreakFreeze && (
                <div className="xs shop-claimed" style={{ color: 'var(--info)' }}>
                  <Check size={12} strokeWidth={3} aria-hidden="true" /> Listo para tu próximo día sin hábitos
                </div>
              )}
            </article>

            {/* Recompensa fija: multiplicador 1.5× de XP durante 12 h */}
            <article className={`shop-item boost${boost.active ? ' owned' : ''}`}>
              <div className="shop-item-display">
                <span className="shop-box" style={{ ['--box' as string]: '#facc15', ['--box-lip' as string]: '#ca8a04' }}>
                  <Zap size={28} aria-hidden="true" />
                </span>
                <span className="badge shop-item-flag" style={{ background: 'color-mix(in srgb, var(--warning) 16%, transparent)', color: 'var(--warning)' }}>
                  {boost.active ? (
                    <>
                      <Zap size={11} aria-hidden="true" /> Activo
                    </>
                  ) : (
                    'Permanente'
                  )}
                </span>
              </div>
              <div className="shop-item-body">
                <div className="shop-item-name" style={{ color: 'var(--warning)' }}>
                  Multiplicador 1.5× XP · {ECONOMY.boostHours} h
                </div>
                <p className="shop-item-desc">
                  Cada hábito que completes durante {ECONOMY.boostHours} h da 1.5× de XP (el tope del día también sube). Una vez cada{' '}
                  {ECONOMY.boostCooldownHours} h · {boost.boughtThisMonth}/{boost.maxPerMonth} este mes.
                </p>
              </div>
              <div className="shop-item-foot">
                <div className="reward-price" style={{ color: 'var(--warning)' }}>
                  <Coins size={18} aria-hidden="true" />
                  <span>{Math.round(boost.price)}</span>
                  <small className="muted" style={{ fontSize: 12 }}>
                    pts
                  </small>
                </div>
                {boost.active ? (
                  <button type="button" className="btn sm btn-secondary shop-owned" disabled>
                    <Hourglass size={14} aria-hidden="true" /> Quedan {formatLeft(Date.parse(boost.active.endsAt) - now)}
                  </button>
                ) : demoMode ? (
                  <button type="button" className="btn sm btn-secondary" disabled title="No disponible con datos de demostración">
                    <FlaskConical size={13} aria-hidden="true" /> No disponible
                  </button>
                ) : boost.blocked === 'cooldown' && boost.availableAt ? (
                  <button type="button" className="btn sm btn-secondary" disabled>
                    <Hourglass size={13} /> En {formatLeft(boost.availableAt - now)}
                  </button>
                ) : boost.blocked === 'month-limit' ? (
                  <button type="button" className="btn sm btn-secondary" disabled>
                    <Lock size={13} /> Límite del mes
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`btn sm ${canBuyBoost ? 'btn-primary' : 'btn-secondary'}`}
                    disabled={!canBuyBoost}
                    onClick={() => setRewardToRedeem('xp_boost')}
                  >
                    {canBuyBoost ? (
                      <>
                        <Zap size={14} /> Activar
                      </>
                    ) : (
                      <>
                        <Lock size={13} /> Faltan {Math.ceil(boost.price - boostBalance)}
                      </>
                    )}
                  </button>
                )}
              </div>
              {demoMode && !boost.active && (
                <div className="xs muted shop-claimed">
                  <FlaskConical size={12} aria-hidden="true" /> No disponible con datos de demostración
                </div>
              )}
            </article>

            {/* Recompensas del usuario */}
            {rewards.map((reward, idx) => {
              const canAfford = pts.balance >= reward.cost;
              const timesClaimed = redemptions.filter((r: Redemption) => r.rewardId === reward.id).length;
              const box = BOX_COLORS[idx % BOX_COLORS.length];

              return (
                <article key={reward.id} className={`shop-item${canAfford ? ' affordable' : ''}`}>
                  <div className="shop-item-display">
                    <span className="shop-box" style={{ ['--box' as string]: box.face, ['--box-lip' as string]: box.lip }}>
                      <span className="shop-box-emoji">{reward.icon}</span>
                    </span>
                    <div className="shop-item-tools">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingReward(reward);
                          setIsModalOpen(true);
                        }}
                        className="icon-btn sm"
                        title="Editar recompensa"
                        aria-label={`Editar «${reward.name}»`}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRewardIdToDelete(reward.id)}
                        className="icon-btn danger sm"
                        title="Eliminar recompensa"
                        aria-label={`Eliminar «${reward.name}»`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="shop-item-body">
                    <div className="shop-item-name" title={reward.name}>
                      {reward.name}
                    </div>
                    <p className="shop-item-desc" title={reward.description || undefined}>
                      {reward.description?.trim() || 'Un momento de descanso y gratificación por tu constancia sostenida.'}
                    </p>
                  </div>

                  <div className="shop-item-foot">
                    <div className="reward-price">
                      <Coins size={18} aria-hidden="true" />
                      <span>{Math.round(reward.cost)}</span>
                      <small className="muted" style={{ fontSize: 12 }}>
                        pts
                      </small>
                    </div>
                    <button
                      type="button"
                      className={`btn sm ${canAfford ? 'shop-buy' : 'btn-secondary'}`}
                      disabled={!canAfford}
                      onClick={() => setRewardToRedeem(reward)}
                    >
                      {canAfford ? (
                        <>
                          <Gift size={14} /> Canjear
                        </>
                      ) : (
                        <>
                          <Lock size={13} /> Faltan {Math.ceil(reward.cost - pts.balance)}
                        </>
                      )}
                    </button>
                  </div>
                  {timesClaimed > 0 && (
                    <div className="xs muted shop-claimed">
                      Canjeado {timesClaimed} {timesClaimed === 1 ? 'vez' : 'veces'}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* PERSONALIZACIÓN: cosméticos que cobra el servidor */}
      <CosmeticsShop />

      {/* RECIBOS: historial de canjes */}
      <section className="shop-receipt" aria-labelledby="shop-receipt-title">
        <div className="shop-receipt-head">
          <ReceiptText size={18} aria-hidden="true" />
          <div>
            <h3 id="shop-receipt-title">Recibos</h3>
            <span>Tus canjes y premios disfrutados</span>
          </div>
        </div>

        {redemptions.length === 0 ? (
          <p className="shop-receipt-empty">Aún no has canjeado recompensas. ¡Completa tus hábitos diarios para sumar puntos!</p>
        ) : (
          <>
            <ul className="shop-receipt-list">
              {redemptions.map((red: Redemption) => (
                <li key={red.id}>
                  <span className="shop-receipt-icon" aria-hidden="true">
                    {red.icon}
                  </span>
                  <span className="shop-receipt-name">
                    {red.name}
                    <small>
                      {new Date(red.date).toLocaleDateString('es-ES', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </span>
                  <span className="shop-receipt-dots" aria-hidden="true" />
                  <span className="shop-receipt-cost">−{Math.round(red.cost)} pts</span>
                </li>
              ))}
            </ul>
            <div className="shop-receipt-total">
              <span>Total canjeado</span>
              <span>−{Math.round(pts.spent)} pts</span>
            </div>
          </>
        )}
      </section>

      {/* Modal para crear o editar */}
      <RewardModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingReward(null);
        }}
        rewardToEdit={editingReward || undefined}
      />

      {/* Modal de confirmación para eliminar recompensa */}
      <ConfirmModal
        isOpen={Boolean(rewardIdToDelete)}
        onClose={() => setRewardIdToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Eliminar recompensa"
        message="¿Estás seguro de que deseas eliminar esta recompensa de tu catálogo? Los canjes pasados se conservarán."
        confirmLabel="Eliminar"
        danger
      />

      {/* Modal de confirmación para canjear recompensa */}
      <ConfirmModal
        isOpen={Boolean(rewardToRedeem)}
        onClose={() => setRewardToRedeem(null)}
        onConfirm={handleConfirmRedeem}
        title={
          rewardToRedeem === 'streak_freeze'
            ? 'Canjear protector de racha'
            : rewardToRedeem === 'xp_boost'
              ? 'Activar multiplicador de XP'
              : `Canjear «${(rewardToRedeem as Reward)?.name}»`
        }
        message={
          rewardToRedeem === 'streak_freeze'
            ? `¿Deseas canjear ${Math.round(freeze.price)} puntos por un Protector de Racha? Protegerá tu racha si un día no completas ningún hábito, manteniéndola congelada en azul (ese día no da monedas ni XP).`
            : rewardToRedeem === 'xp_boost'
              ? `¿Canjear ${Math.round(boost.price)} puntos por el multiplicador? Empieza ahora y dura ${ECONOMY.boostHours} h: cada hábito que completes en ese tiempo da 1.5× de XP.`
              : `¿Canjear «${(rewardToRedeem as Reward)?.name}» por ${(rewardToRedeem as Reward)?.cost} puntos? ¡Disfruta tu recompensa merecida!`
        }
        confirmLabel="¡Sí, canjear!"
        confirmVariant="primary"
        danger={false}
      />
    </div>
  );
};
