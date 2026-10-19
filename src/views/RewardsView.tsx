import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { Reward, Redemption } from '../types';
import { pointsSummary, levelFromXp } from '../lib/metrics';
import {
  Coins,
  Plus,
  Gift,
  Sparkles,
  Trash2,
  Lock,
  Edit3,
  Shield,
  ShieldCheck,
  Snowflake,
  Check,
} from 'lucide-react';
import { RewardModal } from '../components/modals/RewardModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useToast } from '../components/ui/ToastContext';
import { playSound } from '../lib/sound';
import { triggerRewardCelebration } from '../components/ui/RewardCelebrationOverlay';

export const RewardsView: React.FC = () => {
  const { rewards, redemptions, pointEvents, logs, redeem, deleteReward, hasStreakFreeze, buyStreakFreeze } = useStore(useShallow((s) => ({ rewards: s.rewards, redemptions: s.redemptions, pointEvents: s.pointEvents, logs: s.logs, redeem: s.redeem, deleteReward: s.deleteReward, hasStreakFreeze: s.hasStreakFreeze, buyStreakFreeze: s.buyStreakFreeze })));
  const { showToast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [rewardToRedeem, setRewardToRedeem] = useState<Reward | 'streak_freeze' | null>(null);
  const [rewardIdToDelete, setRewardIdToDelete] = useState<string | null>(null);

  const pts = pointsSummary({ logs, pointEvents, redemptions });
  const levelInfo = levelFromXp(pts.earned);

  const handleConfirmRedeem = () => {
    if (!rewardToRedeem) return;

    if (rewardToRedeem === 'streak_freeze') {
      const ok = buyStreakFreeze(150);
      if (ok) {
        // El overlay del cofre reproduce el sonido y el confeti sincronizados con la apertura
        triggerRewardCelebration({
          name: 'Protector de Racha',
          icon: '❄️',
          cost: 150,
          isFreeze: true,
        });
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

  return (
    <div className="stack fade-up">
      {/* Cabecera */}
      <div className="page-head">
        <div>
          <p className="eyebrow">Gamificación y canjes</p>
          <h1>Tienda de recompensas</h1>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingReward(null);
              setIsModalOpen(true);
            }}
          >
            <Plus size={16} /> Nueva recompensa
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
        Canjea los puntos acumulados por tus hábitos completados, sesiones de foco y revisiones semanales en premios reales que disfrutes.
      </p>

      {/* Tarjetas de Saldo y Nivel XP */}
      <div className="grid-2">
        <div className="card highlight">
          <div className="stat">
            <div className="stat-top">
              <span className="stat-label">Puntos disponibles</span>
              <span className="badge warning">Canjeable</span>
            </div>
            <div className="stat-value" style={{ color: 'var(--warning)', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              {pts.balance} <small>pts</small>
            </div>
            <div className="row-between small muted" style={{ marginTop: 8 }}>
              <span>Ganados: +{pts.earned} pts</span>
              <span>Canjeados: -{pts.spent} pts</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="stat">
            <div className="stat-top">
              <span className="stat-label">Nivel de constancia</span>
              <span className="badge accent">Nivel {levelInfo.level}</span>
            </div>
            <div className="stat-value">
              {pts.earned} <small>XP acumulada</small>
            </div>
            <div className="progress thin" style={{ marginTop: 8 }}>
              <div style={{ width: `${Math.round(levelInfo.progress * 100)}%` }} />
            </div>
            <div className="row-between xs muted" style={{ marginTop: 4 }}>
              <span>{Math.round(levelInfo.progress * 100)}% hacia Nivel {levelInfo.level + 1}</span>
              <span>Faltan {levelInfo.xpForNext - levelInfo.xpInLevel} XP</span>
            </div>
          </div>
        </div>
      </div>

      {/* Catálogo de Premios */}
      <div className="stack" style={{ gap: 14 }}>
        <div className="row-between reward-catalog-head">
          <div className="card-title">Catálogo de premios disponibles</div>
          <span className="badge accent">{rewards.length + 1} recompensas</span>
        </div>

        <div className="grid-3 reward-grid">
          {/* Recompensa permanente: Protector de racha */}
          <div className="card reward-card freeze-reward-card">
            <div>
              <div className="row-between reward-card-head">
                <span className="entity-icon lg" style={{ background: 'rgba(56, 189, 248, 0.15)', border: '1px solid #38bdf8', color: '#38bdf8' }}>
                  <Shield size={24} aria-hidden="true" />
                </span>
                <span className="badge" style={{ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', border: '1px solid #38bdf8' }}>
                  {hasStreakFreeze ? <><Snowflake size={11} aria-hidden="true" /> Protección activa</> : 'Permanente'}
                </span>
              </div>

              <div className="reward-name" style={{ color: '#38bdf8' }}>
                Protector de racha (1 día) <Snowflake size={15} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} />
              </div>
              <p className="reward-desc">
                Protege tu racha si un día no realizas hábitos. Mantiene la racha activa en color azul congelado sin romper tu progreso. Máximo 1 en inventario.
              </p>
            </div>

            <div className="reward-card-foot" style={{ borderTopColor: 'rgba(56, 189, 248, 0.25)' }}>
              <div className="row-between reward-foot-row">
                <div className="reward-price">
                  <Coins size={18} style={{ color: '#38bdf8' }} />
                  <span style={{ color: '#38bdf8' }}>150</span>
                  <small className="muted" style={{ fontSize: 12 }}>pts</small>
                </div>

                {hasStreakFreeze ? (
                  <button
                    type="button"
                    disabled
                    className="btn sm btn-secondary reward-redeem-btn"
                    style={{ opacity: 0.85, cursor: 'not-allowed', borderColor: '#38bdf8', color: '#38bdf8' }}
                  >
                    <ShieldCheck size={14} aria-hidden="true" /> Activo (1/1)
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pts.balance < 150}
                    onClick={() => setRewardToRedeem('streak_freeze')}
                    className={`btn sm reward-redeem-btn ${pts.balance >= 150 ? 'btn-primary' : 'btn-secondary'}`}
                    style={pts.balance >= 150 ? { background: '#0284c7', color: '#fff', borderColor: '#38bdf8', boxShadow: '0 0 14px rgba(56, 189, 248, 0.5)' } : {}}
                  >
                    {pts.balance >= 150 ? (
                      <>
                        <Gift size={14} /> Canjear escudo
                      </>
                    ) : (
                      <>
                        <Lock size={13} /> Faltan {150 - pts.balance}
                      </>
                    )}
                  </button>
                )}
              </div>

              {hasStreakFreeze && (
                <div className="xs reward-claimed" style={{ color: '#38bdf8', fontWeight: 600 }}>
                  <span className="icon-label"><Check size={12} strokeWidth={3} aria-hidden="true" /> Listo para proteger tu próximo día sin hábitos</span>
                </div>
              )}
            </div>
          </div>

          {/* Recompensas del usuario */}
          {rewards.map((reward) => {
            const canAfford = pts.balance >= reward.cost;
            const timesClaimed = redemptions.filter((r: Redemption) => r.rewardId === reward.id).length;

            return (
              <div key={reward.id} className="card reward-card">
                <div>
                  <div className="row-between reward-card-head">
                    <span className="entity-icon lg">{reward.icon}</span>
                    <div className="row reward-card-tools">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingReward(reward);
                          setIsModalOpen(true);
                        }}
                        className="icon-btn sm"
                        title="Editar recompensa"
                        aria-label="Editar recompensa"
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRewardIdToDelete(reward.id)}
                        className="icon-btn danger sm"
                        title="Eliminar recompensa"
                        aria-label="Eliminar recompensa"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="reward-name" title={reward.name}>{reward.name}</div>
                  <p className="reward-desc">
                    Disfruta de este momento de descanso y gratificación por tu constancia sostenida.
                  </p>
                </div>

                <div className="reward-card-foot">
                  <div className="row-between reward-foot-row">
                    <div className="reward-price">
                      <Coins size={18} />
                      <span>{reward.cost}</span>
                      <small className="muted" style={{ fontSize: 12 }}>pts</small>
                    </div>

                    <button
                      type="button"
                      disabled={!canAfford}
                      onClick={() => setRewardToRedeem(reward)}
                      className={`btn sm reward-redeem-btn ${canAfford ? 'btn-primary' : 'btn-secondary'}`}
                      style={canAfford ? { background: 'var(--warning)', color: '#0c0c10', borderColor: 'var(--warning)' } : {}}
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
                    <div className="xs muted reward-claimed">
                      Canjeado {timesClaimed} veces
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Historial de canjes */}
      <div className="card flush">
        <div className="card-flush-head">
          <div className="card-title">Historial de recompensas canjeadas</div>
          <div className="card-sub">Registro de tus canjes y premios disfrutados</div>
        </div>

        {redemptions.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center' }} className="muted small">
            Aún no has canjeado recompensas. ¡Completa tus hábitos diarios para sumar puntos!
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table reward-history">
              <thead>
                <tr>
                  <th>Recompensa</th>
                  <th>Fecha de canje</th>
                  <th className="num">Puntos deducidos</th>
                </tr>
              </thead>
              <tbody>
                {redemptions.map((red: Redemption) => (
                  <tr key={red.id}>
                    <td>
                      <div className="row">
                        <span className="entity-icon sm">{red.icon}</span>
                        <span className="bold">{red.name}</span>
                      </div>
                    </td>
                    <td className="muted small">
                      {new Date(red.date).toLocaleDateString('es-ES', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="num bold" style={{ color: 'var(--danger)' }}>
                      -{red.cost} pts
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
            ? '¿Deseas canjear 150 puntos por un Protector de Racha? Protegerá tu racha durante 24 horas si no completas ningún hábito, manteniéndola congelada en azul sin romper tu progreso.'
            : `¿Canjear «${(rewardToRedeem as Reward)?.name}» por ${(rewardToRedeem as Reward)?.cost} puntos? ¡Disfruta tu recompensa merecida!`
        }
        confirmLabel="¡Sí, canjear!"
        confirmVariant="primary"
        danger={false}
      />
    </div>
  );
};
