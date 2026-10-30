import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { COACH_PHRASES, phraseText, pickPhrase, phraseGroup } from '@/lib/coachPhrases';
import { localCoachReply } from '@/lib/coachLocal';
import { parseCoachAction } from '@/lib/coachActions';
import { createDemoData, createEmptyData } from '@/data/seed';
import { personaFor } from '@/components/coach/coachPersona';

/** Todas las variantes de texto del catálogo (Pilo y Pila) */
const allTexts = new Set(COACH_PHRASES.flatMap((p) => [phraseText(p.id, 'male'), phraseText(p.id, 'female')]));

describe('catálogo de frases del coach', () => {
  it('ids únicos y cada frase con texto o con variantes para Pilo y Pila', () => {
    const ids = COACH_PHRASES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of COACH_PHRASES) {
      expect(Boolean(p.text) !== Boolean(p.pilo && p.pila)).toBe(true);
    }
  });

  it('frases de una línea, sin markdown ni emojis (para que coincidan con su audio grabado)', () => {
    for (const t of allTexts) {
      expect(t).not.toMatch(/[\r\n*_`#|[\]<>~]/);
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('la prueba de voz de Ajustes dice exactamente la frase grabada', () => {
    for (const gender of ['male', 'female'] as const) {
      const p = personaFor(gender);
      expect(phraseText('ajustes.prueba_voz', gender)).toBe(
        `¡Hola! Soy ${p.name}, tu ${p.role}. Así sonaré cuando te lea mis consejos. ¡Vamos con todo hoy!`,
      );
    }
  });

  it('las variaciones de un grupo no se repiten seguidas', () => {
    const group = phraseGroup('saludo.apertura.1');
    let prev = '';
    for (let i = 0; i < 30; i++) {
      const t = pickPhrase(group, 'male');
      expect(t).not.toBe(prev);
      prev = t;
    }
  });
});

describe('motor de respuestas local', () => {
  const demo = createDemoData();
  const prompts = [
    'hola', 'buenas noches', 'gracias!', 'adiós, nos vemos', '¿qué puedes hacer?',
    '¿Qué hago ahora mismo?', 'organiza mi día', '¿Cómo salvo mi racha hoy?', 'ayer fallé y perdí mi racha',
    'no tengo ganas de nada', 'no tengo tiempo hoy', 'siempre lo dejo para después', 'estoy muy estresado',
    'estoy agotado', '¿cómo duermo mejor?', 'tips para estudiar', 'quiero hacer más ejercicio', 'revisa mis objetivos',
    'Resume mi semana', '¿por qué me cuesta mi hábito más difícil?', '¿cuál es mi mejor hora del día?',
    'Soy nuevo en la app. Ayúdame a elegir un primer hábito', '¿cuánta XP tengo?', '¿cómo creo un hábito?',
    '¿cómo funciona el temporizador?', '¿para qué sirve la tienda?', '¿cómo funcionan las ligas?', '¿qué son los logros?',
    '¿cómo agrego amigos?', '¿dónde cambio mi avatar del perfil?', '¿cómo pongo el modo oscuro?', '¿cómo activo tu voz?',
    '¿Qué experimento A/B me recomiendas hacer ahora?', 'algo raro que no encaja',
  ];

  it('responde a cada intención, con datos o sin ellos, y con al menos una frase del catálogo en su propia línea', () => {
    for (const data of [demo, createEmptyData()]) {
      for (const prompt of prompts) {
        const reply = localCoachReply(data, prompt);
        expect(reply.trim().length, prompt).toBeGreaterThan(0);
        const paragraphs = reply.split('\n\n').flatMap((p) => p.split('\n').map((l) => l.replace(/^• /, '')));
        expect(paragraphs.some((l) => allTexts.has(l)), prompt).toBe(true);
      }
    }
  });

  it('no habla de la energía como sistema de la app (solo cita, entre comillas, los motivos de fallo registrados)', () => {
    for (const prompt of prompts) {
      const reply = localCoachReply(demo, prompt).replace(/«[^»]*»/g, '');
      expect(reply, prompt).not.toMatch(/energía/i);
    }
  });

  it('propone crear un hábito con nombre, duración y momento del día', () => {
    const reply = localCoachReply(createEmptyData(), 'Créame un hábito de leer 20 minutos por la mañana');
    const json = reply.match(/```action\s*([\s\S]*?)```/)?.[1];
    expect(json).toBeTruthy();
    const action = parseCoachAction(JSON.parse(json!));
    expect(action?.action).toBe('create_habit');
    expect(action?.data).toMatchObject({ name: 'Leer', targetMinutes: 20, preferredTime: 'morning', icon: '📖' });
  });

  it('responde a las propuestas aceptadas o rechazadas', () => {
    const ok = localCoachReply(demo, '✅ Acepté tu propuesta de crear hábito «📖 Leer». Ya está aplicada.');
    const no = localCoachReply(demo, '❌ Rechacé tu propuesta de crear hábito «📖 Leer».');
    expect(ok.split('\n\n')[0]).toMatch(/aplicado|Hecho/i);
    expect(no.split('\n\n')[0]).toMatch(/no lo aplico|como estaba/i);
  });
});
