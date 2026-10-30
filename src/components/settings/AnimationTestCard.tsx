import React, { useState } from 'react';
import { Award, Clapperboard, Flame, Gift, MessageCircleMore, Snowflake, DoorOpen } from 'lucide-react';
import { triggerStreakCelebration } from '@/components/ui/StreakCelebrationOverlay';
import { triggerRewardCelebration } from '@/components/ui/RewardCelebrationOverlay';
import { triggerAchievementCelebration } from '@/components/ui/AchievementUnlockOverlay';
import { RARITY } from '@/social/texts';
import type { Rarity } from '@/social/types';
import { FLAME_LEVELS, getFlameLevel, StreakFlame } from '@/components/ui/StreakFlame';
import { triggerCoachTeaser } from '@/components/coach/coachTeasers';
import { useCoachPersona } from '@/components/coach/coachPersona';
import { openWelcomePreview } from '@/components/modals/WelcomeModal';

const MIN_DAYS = 1;
/** Diez años: la racha real no tiene tope */
const MAX_DAYS = 3650;

/** Hitos donde la llama cambia de nivel (ver FLAME_LEVELS) */
const MILESTONES = FLAME_LEVELS.filter((l) => l.minDays > 0).map((l) => l.minDays);

const clampDays = (n: number) => Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(n)));

/** Logros de ejemplo, uno por rareza (la animación crece de común a legendaria) */
const SAMPLE_ACHIEVEMENTS: Record<Rarity, { name: string; icon: string; description: string; prize: number }> = {
  common: { name: 'Primer paso', icon: '👣', description: 'Completa tu primer hábito', prize: 10 },
  rare: { name: 'Semana redonda', icon: '📅', description: 'Una semana perfecta', prize: 50 },
  epic: { name: 'Racha imparable', icon: '🔥', description: '30 días seguidos de racha', prize: 150 },
  legendary: { name: 'Leyenda de ¡Pilas!', icon: '👑', description: '365 días seguidos de racha', prize: 500 },
};
const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/**
 * Lanza a voluntad las celebraciones de racha y de canje para verlas.
 * Solo dispara lo visual y sonoro: no toca el store (ni registros, ni puntos, ni rachas).
 */
export const AnimationTestCard: React.FC = () => {
  const [daysInput, setDaysInput] = useState('7');
  const [isSuper, setIsSuper] = useState(false);
  const [rarity, setRarity] = useState<Rarity>('epic');
  const coachName = useCoachPersona().name;

  // Solo la animación: no concede el logro ni suma monedas
  const handleAchievement = () => triggerAchievementCelebration({ ...SAMPLE_ACHIEVEMENTS[rarity], rarity });

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

        {/* Logro */}
        <div className="field">
          <span className="label" id="anim-test-rarity">
            Logro desbloqueado
          </span>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} role="radiogroup" aria-labelledby="anim-test-rarity">
            {RARITIES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={rarity === r}
                className={`chip ${rarity === r ? 'active' : ''}`}
                onClick={() => setRarity(r)}
              >
                {RARITY[r].label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-secondary" onClick={handleAchievement} style={{ alignSelf: 'flex-start' }}>
            <Award size={16} style={{ color: 'var(--accent-2)' }} />
            Probar logro «{SAMPLE_ACHIEVEMENTS[rarity].name}» (rareza {RARITY[rarity].label.toLowerCase()})
          </button>
          <span className="hint">Es solo una vista previa: no se concede el logro ni se suman monedas.</span>
        </div>

        {/* Aviso del coach */}
        <div className="field">
          <span className="label">Aviso de {coachName}</span>
          <button type="button" className="btn btn-secondary" onClick={triggerCoachTeaser} style={{ alignSelf: 'flex-start' }}>
            <MessageCircleMore size={16} style={{ color: 'var(--accent-2)' }} />
            Mostrar un aviso junto a su botón
          </button>
          <span className="hint">Siempre sale uno al entrar a la app; después, como mucho cada 2 horas y 4 veces al día.</span>
        </div>

        {/* Pantalla de inicio */}
        <div className="field">
          <span className="label">Pantalla de inicio</span>
          <button type="button" className="btn btn-secondary" onClick={openWelcomePreview} style={{ alignSelf: 'flex-start' }}>
            <DoorOpen size={16} style={{ color: 'var(--accent-2)' }} />
            Ver el menú de inicio de la app
          </button>
          <span className="hint">La bienvenida del primer uso. Es solo una vista previa: no borra ni cambia nada.</span>
        </div>
      </div>
    </div>
  );
};
