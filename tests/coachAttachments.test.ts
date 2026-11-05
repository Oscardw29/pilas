import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT_CHARS,
  attachmentKind,
  attachmentsNote,
  geminiUserParts,
  openAiUserContent,
  promptWithTextFiles,
  toStored,
  type CoachAttachment,
} from '@/lib/coachAttachments';
import { handle, readAttachments } from '../supabase/functions/pilas-ai/index';

/** Adjuntos del chat del coach: qué se acepta, qué se guarda y cómo le llega a cada proveedor */

const photo: CoachAttachment = { id: 'a1', name: 'plato.jpg', mime: 'image/jpeg', size: 1200, kind: 'image', thumb: 'data:image/jpeg;base64,AAA', data: 'QUJD' };
const pdf: CoachAttachment = { id: 'a2', name: 'analisis.pdf', mime: 'application/pdf', size: 3000, kind: 'pdf', data: 'UERG' };
const notes: CoachAttachment = { id: 'a3', name: 'rutina.csv', mime: 'text/csv', size: 20, kind: 'text', text: 'dia,minutos\nlunes,20' };

describe('adjuntos en la app', () => {
  it('reconoce imágenes, PDF y texto, y rechaza el resto', () => {
    expect(attachmentKind({ name: 'a.png', type: 'image/png' })).toBe('image');
    expect(attachmentKind({ name: 'a.pdf', type: '' })).toBe('pdf');
    expect(attachmentKind({ name: 'datos.csv', type: '' })).toBe('text');
    expect(attachmentKind({ name: 'notas.md', type: 'text/markdown' })).toBe('text');
    expect(attachmentKind({ name: 'logo.svg', type: 'image/svg+xml' })).toBeNull();
    expect(attachmentKind({ name: 'informe.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBeNull();
  });

  it('en la conversación solo se guarda la ficha, nunca el contenido', () => {
    expect(toStored(photo)).toEqual({ id: 'a1', name: 'plato.jpg', mime: 'image/jpeg', size: 1200, kind: 'image', thumb: 'data:image/jpeg;base64,AAA' });
    expect(toStored(notes)).not.toHaveProperty('text');
    expect(toStored(pdf)).not.toHaveProperty('data');
  });

  it('el texto de los archivos va con la pregunta y se recorta si es enorme', () => {
    expect(promptWithTextFiles('¿Qué ves?', [notes])).toContain('Archivo adjunto «rutina.csv»:\n"""\ndia,minutos\nlunes,20\n"""');
    const long = promptWithTextFiles('x', [{ ...notes, text: 'a'.repeat(MAX_TEXT_CHARS + 50) }]);
    expect(long).toContain('archivo recortado');
    expect(long.length).toBeLessThan(MAX_TEXT_CHARS + 200);
  });

  it('Gemini recibe los archivos como inlineData', () => {
    expect(geminiUserParts('Hola', [photo, pdf, notes])).toEqual([
      { text: expect.stringContaining('Hola') },
      { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } },
      { inlineData: { mimeType: 'application/pdf', data: 'UERG' } },
    ]);
  });

  it('OpenAI y OpenRouter reciben image_url y file; sin archivos, texto simple', () => {
    expect(openAiUserContent('Hola', [])).toBe('Hola');
    expect(openAiUserContent('Hola', [notes])).toContain('rutina.csv');
    expect(openAiUserContent('Hola', [photo, pdf])).toEqual([
      { type: 'text', text: 'Hola' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
      { type: 'file', file: { filename: 'analisis.pdf', file_data: 'data:application/pdf;base64,UERG' } },
    ]);
  });

  it('el historial menciona los adjuntos de mensajes anteriores', () => {
    expect(attachmentsNote([{ name: 'plato.jpg' }, { name: 'rutina.csv' }])).toBe('\n[Adjuntó: plato.jpg, rutina.csv]');
    expect(attachmentsNote(undefined)).toBe('');
  });
});

describe('adjuntos en la función pilas-ai', () => {
  it('valida tipo, base64 y cantidad', () => {
    expect(readAttachments(undefined)).toEqual([]);
    expect(readAttachments([{ name: 'a.jpg', mime: 'image/jpeg', data: 'QUJD' }])).toEqual([{ name: 'a.jpg', mime: 'image/jpeg', data: 'QUJD' }]);
    expect(readAttachments([{ name: 'n.txt', mime: 'text/plain', text: 'hola' }])).toEqual([{ name: 'n.txt', mime: 'text/plain', text: 'hola' }]);
    expect(readAttachments([{ name: 'x.exe', mime: 'application/x-msdownload', data: 'QUJD' }])).toBeNull();
    expect(readAttachments([{ name: 'a.jpg', mime: 'image/jpeg', data: 'no es base64!' }])).toBeNull();
    expect(readAttachments(Array.from({ length: 5 }, () => ({ name: 'a.jpg', mime: 'image/jpeg', data: 'QUJD' })))).toBeNull();
    expect(readAttachments('nada')).toBeNull();
  });

  const env = { url: 'https://proyecto.supabase.co', serviceKey: 'servicio' };
  const backend = (provider: string, reply: unknown) => {
    const calls: { url: string; body: any }[] = [];
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'p1' }));
      if (url.endsWith('/rpc/ai_authorize')) return new Response(JSON.stringify({ ok: true, provider, api_key: 'k', model: 'm', backup_model: '', voice: '' }));
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(reply));
    }) as typeof fetch;
    return { f, calls };
  };
  const req = (body: unknown) =>
    new Request('https://proyecto.supabase.co/functions/v1/pilas-ai', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) });

  it('pasa la foto y el texto a Gemini', async () => {
    const { f, calls } = backend('gemini', { candidates: [{ content: { parts: [{ text: 'Veo una ensalada' }] } }] });
    const res = await handle(
      req({ service: 'llm', prompt: '¿Qué tal?', attachments: [{ name: 'a.jpg', mime: 'image/jpeg', data: 'QUJD' }, { name: 'n.txt', text: 'lunes' }] }),
      env,
      f,
    );
    expect(await res.json()).toEqual({ text: 'Veo una ensalada' });
    const parts = calls[0].body.contents.at(-1).parts;
    expect(parts[0].text).toContain('Archivo adjunto «n.txt»');
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
  });

  it('Groq no recibe PDF (no los lee) pero sí el resto', async () => {
    const { f, calls } = backend('groq', { choices: [{ message: { content: 'ok' } }] });
    await handle(
      req({ service: 'llm', prompt: 'Mira', attachments: [{ name: 'x.pdf', mime: 'application/pdf', data: 'UERG' }, { name: 'a.png', mime: 'image/png', data: 'QUJD' }] }),
      env,
      f,
    );
    const content = calls[0].body.messages.at(-1).content;
    expect(content).toEqual([
      { type: 'text', text: 'Mira' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ]);
  });

  it('rechaza adjuntos no válidos antes de gastar un uso', async () => {
    const { f, calls } = backend('gemini', {});
    const res = await handle(req({ service: 'llm', prompt: 'x', attachments: [{ name: 'v.exe', mime: 'application/octet-stream', data: 'QUJD' }] }), env, f);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
