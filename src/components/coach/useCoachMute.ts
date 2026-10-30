import { useStore } from '@/store/useStore';
import { coachVoiceMode, ensureClipManifest, stopCoachVoice, useCoachVoiceMode, VOICE_SETTINGS_PLACE, type CoachVoiceMode } from '@/lib/coachVoice';
import { playSound } from '@/lib/sound';
import { useToast } from '@/components/ui/ToastContext';
import { useCoachPersona } from './coachPersona';

/**
 * SILENCIO DEL COACH (botón del altavoz en su página y en el chat flotante)
 * Sin voz configurada (ni clave de TTS ni frases grabadas) el coach está silenciado aunque el ajuste
 * diga lo contrario: no suena nada, el botón se ve en silencio y, al intentar activarlo, un aviso explica
 * dónde configurar la voz en lugar de activarlo. En cuanto hay voz, vale el ajuste `coachMuted`.
 */
export function useCoachMute(): { muted: boolean; hasVoice: boolean; mode: CoachVoiceMode; toggleMute: () => void } {
  const persona = useCoachPersona();
  const { toast } = useToast();
  const storedMuted = useStore((s) => Boolean(s.settings.coachMuted));
  const updateSettings = useStore((s) => s.updateSettings);
  const mode = useCoachVoiceMode(persona.gender);
  const hasVoice = mode !== 'none';
  const muted = storedMuted || !hasVoice;

  const toggleMute = async () => {
    // Las frases grabadas pueden no haber cargado aún (o falló la primera vez): se espera antes de decir que no hay voz
    let voice = hasVoice;
    if (!voice) {
      await ensureClipManifest();
      voice = coachVoiceMode(persona.gender) !== 'none';
    }
    if (!voice) {
      playSound.blocked();
      toast(
        `${persona.name} todavía no tiene voz`,
        'warning',
        `Configúrala en ${VOICE_SETTINGS_PLACE}: elige la plataforma de voz y pega su clave. También sirve una clave de Gemini en «Inteligencia Artificial y Coach Conductual».`,
      );
      return;
    }
    // Si la voz acaba de aparecer, el botón se veía silenciado: pulsarlo es activar el sonido
    const nextMuted = hasVoice ? !muted : false;
    if (nextMuted) stopCoachVoice({ fade: true });
    updateSettings({ coachMuted: nextMuted });
    playSound.toggle();
  };

  return { muted, hasVoice, mode, toggleMute: () => void toggleMute() };
}
