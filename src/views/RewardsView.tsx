import React, { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { Reward, Redemption } from '../types';
import { pointsSummary, levelFromXp } from '../lib/metrics';
import { Coins, Plus, Gift, Trash2, Lock, Edit3, Shield, ShieldCheck, Snowflake, Check, ReceiptText, Store } from 'lucide-react';
import { RewardModal } from '../components/modals/RewardModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useToast } from '../components/ui/ToastContext';
import { playSound } from '../lib/sound';
import { triggerRewardCelebration } from '../components/ui/RewardCelebrationOverlay';
import { CoachAvatar } from '../components/coach/CoachAvatar';
import { useCoachPersona } from '../components/coach/coachPersona';
import { CashRegister, ShopAwning, ShopBackShelf } from '../components/shop/ShopArt';
import '../components/shop/shop.css';

const FREEZE_COST = 150;

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
  const { rewards, redemptions, pointEvents, logs, redeem, deleteReward, hasStreakFreeze, buyStreakFreeze } = useStore(useShallow((s) => ({ rewards: s.rewards, redemptions: s.redemptions, pointEvents: s.pointEvents, logs: s.logs, redeem: s.redeem, deleteReward: s.deleteReward, hasStreakFreeze: s.hasStreakFreeze, buyStreakFreeze: s.buyStreakFreeze })));
  const { showToast } = useToast();
  const persona = useCoachPersona();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [rewardToRedeem, setRewardToRedeem] = useState<Reward | 'streak_freeze' | null>(null);
  const [rewardIdToDelete, setRewardIdToDelete] = useState<string | null>(null);
  /** El tendero celebra cada canje */
  const [cheerKey, setCheerKey] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (!cheerKey) return;
    setCelebrating(true);
    const t = setTimeout(() => setCelebrating(false), 6000);
    return () => clearTimeout(t);
  }, [cheerKey]);

  const pts = pointsSummary({ logs, pointEvents, redemptions });
  const levelInfo = levelFromXp(pts.earned);

  // Lo que dice el tendero según el saldo
  const shopkeeperLine = useMemo(() => {
    if (celebrating) return '¡Buena elección! Disfrútalo, te lo ganaste 🎉';
    const affordable = rewards.filter((r) => r.cost <= pts.balance).length + (!hasStreakFreeze && pts.balance >= FREEZE_COST ? 1 : 0);
    if (affordable > 0) return `¡Hola! Con tus ${pts.balance} pts te alcanza para ${affordable} ${affordable === 1 ? 'premio' : 'premios'}.`;
    const next = [...rewards].sort((a, b) => a.cost - b.cost).find((r) => r.cost > pts.balance);
    if (next) return `Te faltan ${next.cost - pts.balance} pts para «${next.name}». ¡Tú puedes!`;
    return '¡Hola! Añade premios a la estantería y ve por ellos.';
  }, [celebrating, rewards, pts.balance, hasStreakFreeze]);

  // El bocadillo se escribe letra a letra cada vez que cambia la frase
  const [typed, setTyped] = useState(0);
  const lineChars = Array.from(shopkeeperLine);
  useEffect(() => setTyped(0), [shopkeeperLine]);
  useEffect(() => {
    if (typed >= lineChars.length) return;
    const t = setTimeout(() => setTyped((n) => n + 1), typed === 0 ? 450 : 30);
    return () => clearTimeout(t);
  }, [typed, lineChars.length]);

  const handleConfirmRedeem = () => {
    if (!rewardToRedeem) return;

    if (rewardToRedeem === 'streak_freeze') {
      const ok = buyStreakFreeze(FREEZE_COST);
      if (ok) {
        // El overlay del cofre reproduce el sonido y el confeti sincronizados con la apertura
        triggerRewardCelebration({
          name: 'Protector de Racha',
          icon: '❄️',
          cost: FREEZE_COST,
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

  const canAffordFreeze = pts.balance >= FREEZE_COST;

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
              Canjea los puntos de tus hábitos, sesiones de foco y revisiones semanales por premios reales que disfrutes.
            </p>

            <div className="shop-stats">
              <div className="shop-stat">
                <div className="stat-top">
                  <span className="stat-label">Puntos disponibles</span>
                  <span className="badge warning">Canjeable</span>
                </div>
                <div className="stat-value shop-balance">
                  <Coins size={20} aria-hidden="true" /> {pts.balance} <small>pts</small>
                </div>
                <div className="row-between xs muted">
                  <span>Ganados: +{pts.earned}</span>
                  <span>Canjeados: −{pts.spent}</span>
                </div>
              </div>

              <div className="shop-stat">
                <div className="stat-top">
                  <span className="stat-label">Nivel de constancia</span>
                  <span className="badge accent">Nivel {levelInfo.level}</span>
                </div>
                <div className="stat-value">
                  {pts.earned} <small>XP</small>
                </div>
                <div className="progress thin">
                  <div style={{ width: `${Math.round(levelInfo.progress * 100)}%` }} />
                </div>
                <div className="row-between xs muted">
                  <span>{Math.round(levelInfo.progress * 100)}% hacia nivel {levelInfo.level + 1}</span>
                  <span>Faltan {levelInfo.xpForNext - levelInfo.xpInLevel} XP</span>
                </div>
              </div>
            </div>
          </div>

          <div className="shop-front-scene" aria-hidden="true">
            <ShopBackShelf />
            <div className="shop-keeper">
              <div className="shop-bubble">
                {lineChars.slice(0, typed).join('')}
                <span className="shop-bubble-ghost">{lineChars.slice(typed).join('')}</span>
              </div>
              <CoachAvatar
                gender={persona.gender}
                crop="bust"
                size={176}
                outfit="shop"
                expression={celebrating ? 'excited' : 'happy'}
                gesture={cheerKey ? 'cheer' : 'wave'}
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
          <div className="row" style={{ gap: 10 }}>
            <span className="badge accent">{rewards.length + 1} recompensas</span>
            <button type="button" className="btn btn-primary sm" onClick={openNew}>
              <Plus size={15} /> Nuevo premio
            </button>
          </div>
        </div>

        <div className="shop-shelves">
          {/* Recompensa permanente: Protector de racha */}
          <article className={`shop-item freeze${hasStreakFreeze ? ' owned' : ''}`}>
            <div className="shop-item-display">
              <span className="shop-box" style={{ ['--box' as string]: '#38bdf8', ['--box-lip' as string]: '#0284c7' }}>
                <Shield size={28} aria-hidden="true" />
              </span>
              <span className="badge shop-item-flag" style={{ background: 'rgba(56, 189, 248, 0.16)', color: '#38bdf8' }}>
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
              <div className="shop-item-name" style={{ color: '#38bdf8' }}>
                Protector de racha (1 día)
              </div>
              <p className="shop-item-desc">Si un día no haces hábitos, tu racha se congela en azul en vez de romperse. Máximo 1 en inventario.</p>
            </div>
            <div className="shop-item-foot">
              <div className="reward-price" style={{ color: '#38bdf8' }}>
                <Coins size={18} aria-hidden="true" />
                <span>{FREEZE_COST}</span>
                <small className="muted" style={{ fontSize: 12 }}>
                  pts
                </small>
              </div>
              {hasStreakFreeze ? (
                <button type="button" className="btn sm btn-secondary shop-owned" disabled>
                  <ShieldCheck size={14} aria-hidden="true" /> Activo (1/1)
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
                      <Lock size={13} /> Faltan {FREEZE_COST - pts.balance}
                    </>
                  )}
                </button>
              )}
            </div>
            {hasStreakFreeze && (
              <div className="xs shop-claimed" style={{ color: '#38bdf8' }}>
                <Check size={12} strokeWidth={3} aria-hidden="true" /> Listo para tu próximo día sin hábitos
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
                  <p className="shop-item-desc">Un momento de descanso y gratificación por tu constancia sostenida.</p>
                </div>

                <div className="shop-item-foot">
                  <div className="reward-price">
                    <Coins size={18} aria-hidden="true" />
                    <span>{reward.cost}</span>
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
                        <Lock size={13} /> Faltan {reward.cost - pts.balance}
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
      </div>

      {/* RECIBOS: historial de canjes */}
      <section className="card flush shop-receipt" aria-labelledby="shop-receipt-title">
        <div className="card-flush-head shop-receipt-head">
          <ReceiptText size={17} aria-hidden="true" />
          <div>
            <div className="card-title" id="shop-receipt-title">
              Recibos
            </div>
            <div className="card-sub">Registro de tus canjes y premios disfrutados</div>
          </div>
        </div>

        {redemptions.length === 0 ? (
          <div className="muted small shop-receipt-empty">Aún no has canjeado recompensas. ¡Completa tus hábitos diarios para sumar puntos!</div>
        ) : (
          <>
            <ul className="shop-receipt-list">
              {redemptions.map((red: Redemption) => (
                <li key={red.id}>
                  <span className="entity-icon sm" aria-hidden="true">
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
                  <span className="shop-receipt-cost">−{red.cost} pts</span>
                </li>
              ))}
            </ul>
            <div className="shop-receipt-total">
              <span>Total canjeado</span>
              <span>−{pts.spent} pts</span>
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
            : `Canjear «${(rewardToRedeem as Reward)?.name}»`
        }
        message={
          rewardToRedeem === 'streak_freeze'
            ? `¿Deseas canjear ${FREEZE_COST} puntos por un Protector de Racha? Protegerá tu racha durante 24 horas si no completas ningún hábito, manteniéndola congelada en azul sin romper tu progreso.`
            : `¿Canjear «${(rewardToRedeem as Reward)?.name}» por ${(rewardToRedeem as Reward)?.cost} puntos? ¡Disfruta tu recompensa merecida!`
        }
        confirmLabel="¡Sí, canjear!"
        confirmVariant="primary"
        danger={false}
      />
    </div>
  );
};
