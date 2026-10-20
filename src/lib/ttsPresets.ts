/** Modelos de voz (TTS) por proveedor que se ofrecen en Ajustes */
export interface TtsModelOption {
  id: string;
  name: string;
  defaultVoice?: string;
}

export const PRESET_TTS_MODELS: Record<string, TtsModelOption[]> = {
  fish_audio: [
    { id: 's2.1-pro-free', name: 'Fish Audio S2.1 Pro Free (Gratuito / Alta fidelidad)', defaultVoice: '' },
    { id: 's2-pro', name: 'Fish Audio S2 Pro (Última generación profesional)', defaultVoice: '' },
    { id: 's2.1-pro', name: 'Fish Audio S2.1 Pro (Expresión avanzada y dicción fluida)', defaultVoice: '' },
    { id: 's2', name: 'Fish Audio S2 (Nueva generación estándar)', defaultVoice: '' },
    { id: 's1', name: 'Fish Audio S1 (Neuronal ultra-realista)', defaultVoice: '' },
    { id: 'tts-1', name: 'Fish Audio TTS-1 (Baja latencia)', defaultVoice: '' },
    { id: 'speech-1', name: 'Fish Audio Speech-1 (Conversacional)', defaultVoice: '' },
  ],
  elevenlabs: [
    { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2 (Español nativo recomendado)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
    { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5 (Tiempo real ultra-rápido ~75ms)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
    { id: 'eleven_turbo_v2_5', name: 'Eleven Turbo v2.5 (Baja latencia)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
    { id: 'eleven_turbo_v2', name: 'Eleven Turbo v2 (Alta velocidad)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
    { id: 'eleven_multilingual_v1', name: 'Eleven Multilingual v1 (Clásico)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
    { id: 'eleven_monolingual_v1', name: 'Eleven English v1 (Solo inglés)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
  ],
  openai: [
    { id: 'tts-1', name: 'OpenAI TTS-1 (Baja latencia estándar)', defaultVoice: 'nova' },
    { id: 'tts-1-hd', name: 'OpenAI TTS-1 HD (Alta fidelidad 24kHz)', defaultVoice: 'nova' },
    { id: 'gpt-4o-audio-preview', name: 'OpenAI GPT-4o Audio Preview (Neuronal avanzado)', defaultVoice: 'nova' },
  ],
  native: [
    { id: 'browser-native', name: 'Síntesis Nativa del Navegador (Web Speech)', defaultVoice: 'es-ES' },
  ],
};
