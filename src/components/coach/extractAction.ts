import { parseCoachAction, type ParsedAction } from '@/lib/coachActions';

/** Separa el bloque ```action``` (acción sugerida por el coach) del texto visible del mensaje */
export function extractActionAndText(content: string): { text: string; action: ParsedAction | null } {
  const match = content.match(/```action\s*([\s\S]*?)\s*```/);
  if (!match) {
    return { text: content, action: null };
  }
  const actionJson = match[1];
  const cleanedText = content.replace(/```action\s*[\s\S]*?\s*```/, '').trim();
  try {
    const action = parseCoachAction(JSON.parse(actionJson));
    if (action) return { text: cleanedText, action };
  } catch {
    // Si aún está en streaming
  }
  return { text: cleanedText || content, action: null };
}
