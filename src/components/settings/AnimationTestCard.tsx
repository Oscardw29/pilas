import React, { useState } from 'react';
import { Clapperboard, Flame, Gift, MessageCircleMore, Snowflake } from 'lucide-react';
import { triggerStreakCelebration } from '@/components/ui/StreakCelebrationOverlay';
import { triggerRewardCelebration } from '@/components/ui/RewardCelebrationOverlay';
import { FLAME_LEVELS, getFlameLevel, StreakFlame } from '@/components/ui/StreakFlame';
import { triggerCoachTeaser } from '@/components/coach/coachTeasers';
import { useCoachPersona } from '@/components/coach/coachPersona';

const MIN_DAYS = 1;
/** Diez años: la racha real no tiene tope */
const MAX_DAYS = 3650;

/** Hitos donde la llama cambia de nivel (ver FLAME_LEVELS) */
const MILESTONES = FLAME_LEVELS.filter((l) => l.minDays > 0).map((l) => l.minDays);

const clampDays = (n: number) => Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(n)));

/**
 * Lanza a voluntad las celebraciones de racha y de canje para verlas.
 * Solo dispara lo visual y sonoro: no toca el store (ni registros, ni puntos, ni rachas).
 */
export const AnimationTestCard: React.FC = () => {
  const [daysInput, setDaysInput] = useState('7');
  const [isSuper, setIsSuper] = useState(false);
  const coachName = useCoachPersona().name;

  const parsed = Number(daysInput);
  const days = Number.isFinite(parsed) && daysInput.trim() !== '' ? clampDays(parsed) : MIN_DAYS;
  const level = getFlameLevel(days);
  const levelIndex = FLAME_LEVELS.indexOf(level);

  const handleStreak = () => {
    setDaysInput(String(days));
    // El overlay reproduce el sonido y las partículas
    triggerStreakCelebration({ days, isSuper });
  };

  // El overlay del cofre reproduce los sonidos y el confeti sincronizados con la secuencia
  const handleReward = () => {
    triggerRewardCelebration({ name: 'Noche de película', icon: '🍿', cost: 200, isFreeze: false });
  };

  const handleFreeze = () => {
    triggerRewardCelebration({ name: 'Protector de Racha', icon: '❄️', cost: 150, isFreeze: true });
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="row">
          <Clapperboard size={18} style={{ color: 'var(--accent-2)' }} />
          <div>
            <div className="card-title">Probar animaciones</div>
            <div className="card-sub">Mira las celebraciones sin cambiar tus rachas, puntos ni registros</div>
          </div>
        </div>
      </div>

      <div className="form">
        {/* Racha */}
        <div className="field">
          <span className="label">Animación de racha</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input
              type="number"
              className="input"
              min={MIN_DAYS}
              max={MAX_DAYS}
              step={1}
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
              onBlur={() => setDaysInput(String(days))}
              aria-label="Días de racha"
              style={{ width: 110 }}
            />
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{days === 1 ? 'día' : 'días'}</span>
            <label className="custom-switch" style={{ marginLeft: 'auto' }}>
              <input type="checkbox" checked={isSuper} onChange={(e) => setIsSuper(e.target.checked)} />
              <span className="custom-switch-track">
                <span className="custom-switch-thumb" />
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>Súper racha</span>
            </label>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {MILESTONES.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${days === m ? 'active' : ''}`}
                onClick={() => setDaysInput(String(m))}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <StreakFlame days={m} size={16} isSuperStreak={isSuper} />
                {m}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 12 }}>
            <StreakFlame days={days} size={56} isSuperStreak={isSuper} />
            <span className="hint">
              Llama: {level.name} (nivel {levelIndex} de {FLAME_LEVELS.length - 1}). Cambia de forma, color y efectos en cada
              hito; la súper racha usa la variante violeta y azul.
            </span>
          </div>
          <button type="button" className="btn btn-secondary" onClick={handleStreak} style={{ alignSelf: 'flex-start' }}>
            <Flame size={16} style={{ color: 'var(--accent-2)' }} />
            Probar racha de {days} {days === 1 ? 'día' : 'días'}
          </button>
        </div>

        {/* Recompensa */}
        <div className="field">
          <span className="label">Apertura de recompensa</span>
          <div className="grid-2">
            <button type="button" className="btn btn-secondary" onClick={handleReward} style={{ padding: 14 }}>
              <Gift size={16} style={{ color: 'var(--accent-2)' }} />
              Abrir recompensa de ejemplo
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleFreeze} style={{ padding: 14 }}>
              <Snowflake size={16} style={{ color: 'var(--accent-2)' }} />
              Probar protector de racha
            </button>
          </div>
          <span className="hint">Es solo una vista previa: no se gastan puntos ni se crea ningún canje.</span>
        </div>

        {/* Aviso del coach */}
        <div className="field">
          <span className="label">Aviso de {coachName}</span>
          <button type="button" className="btn btn-secondary" onClick={triggerCoachTeaser} style={{ alignSelf: 'flex-start' }}>
            <MessageCircleMore size={16} style={{ color: 'var(--accent-2)' }} />
            Mostrar un aviso junto a su botón
          </button>
          <span className="hint">Normalmente aparece solo, como mucho cada 2 horas y 4 veces al día.</span>
        </div>
      </div>
    </div>
  );
};
