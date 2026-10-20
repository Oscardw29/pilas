import { parseCoachAction, type ParsedAction } from '@/lib/coachActions';
import { stripVoiceTags } from '@/lib/voiceTags';

/**
 * Separa el bloque ```action``` (acción sugerida por el coach) del texto visible del mensaje.
 * Las etiquetas de voz ([excited], [pause]…) son solo para el TTS: aquí se quitan del texto visible.
 */
export function extractActionAndText(content: string): { text: string; action: ParsedAction | null } {
  const match = content.match(/```action\s*([\s\S]*?)\s*```/);
  if (!match) {
    return { text: stripVoiceTags(content), action: null };
  }
  const actionJson = match[1];
  const cleanedText = stripVoiceTags(content.replace(/```action\s*[\s\S]*?\s*```/, '').trim());
  try {
    const action = parseCoachAction(JSON.parse(actionJson));
    if (action) return { text: cleanedText, action };
  } catch {
    // Si aún está en streaming
  }
  return { text: cleanedText || stripVoiceTags(content), action: null };
}
