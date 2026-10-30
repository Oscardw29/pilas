import React, { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useCoachSpeaking } from '@/lib/coachVoice';
import { CoachAvatar, type CoachExpression } from './CoachAvatar';
import { useCoachPersona } from './coachPersona';
import { useCoachMute } from './useCoachMute';

interface CoachStageProps {
  /** Esperando la respuesta de la IA */
  thinking: boolean;
  /** Sube cada vez que se aplica una acción sugerida: el coach lo celebra */
  cheerKey: number;
}

/**
 * El coach en su página, debajo de la lista de conversaciones: lee las respuestas moviendo la boca
 * y gesticulando. A su izquierda, el botón para silenciarle (corta la voz con un fundido de 0,5 s).
 * Sin voz configurada queda silenciado y el botón avisa de dónde configurarla (useCoachMute).
 */
export const CoachStage: React.FC<CoachStageProps> = ({ thinking, cheerKey }) => {
  const persona = useCoachPersona();
  const { muted, hasVoice, toggleMute } = useCoachMute();
  const speaking = useCoachSpeaking();
  const [cheering, setCheering] = useState(false);

  useEffect(() => {
    if (!cheerKey) return;
    setCheering(true);
    const t = setTimeout(() => setCheering(false), 1400);
    return () => clearTimeout(t);
  }, [cheerKey]);

  const expression: CoachExpression = cheering ? 'excited' : thinking ? 'thinking' : speaking ? 'neutral' : 'happy';
  const status = thinking ? 'Pensando…' : speaking ? 'Hablando…' : !hasVoice
        ? 'Sin voz configurada'
        : muted
        ? persona.gender === 'female' ? 'Silenciada' : 'Silenciado'
        : persona.gender === 'female' ? 'Lista para ayudarte' : 'Listo para ayudarte';

  return (
    <section className={`card coach-stage${speaking ? ' speaking' : ''}${thinking ? ' thinking' : ''}`} aria-label={persona.name}>
      <button
        type="button"
        className={`coach-mute-btn${muted ? ' muted' : ''}`}
        onClick={toggleMute}
        aria-pressed={muted}
        aria-label={muted ? `Activar la voz de ${persona.name}` : `Silenciar a ${persona.name}`}
        title={!hasVoice ? 'Sin voz: configúrala en Ajustes' : muted ? 'Activar voz' : 'Silenciar'}
        data-no-sound="true"
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        <span className="coach-mute-label">{muted ? 'Sin voz' : 'Voz'}</span>
      </button>

      <div className="coach-stage-figure">
        <span className="coach-stage-halo" aria-hidden="true" />
        <CoachAvatar
          gender={persona.gender}
          crop="bust"
          size={164}
          expression={expression}
          talk
          // Saluda al entrar y, después, celebra cada acción aplicada
          gesture={cheerKey ? 'cheer' : 'wave'}
          gestureKey={cheerKey || 1}
        />
      </div>

      <div className="coach-stage-plate">
        <strong>{persona.name}</strong>
        <span className="coach-stage-status" aria-live="polite">
          {speaking && (
            <span className="coach-voice-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          {status}
        </span>
      </div>
    </section>
  );
};
