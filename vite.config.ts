import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleFishTts } from './api/_fishRelay';

/**
 * Content-Security-Policy para producción. No se aplica en desarrollo porque el HMR de Vite
 * necesita scripts inline. 'unsafe-inline' en estilos es necesario por los estilos en línea de React.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://generativelanguage.googleapis.com https://api.openai.com https://api.groq.com https://openrouter.ai https://api.elevenlabs.io https://api.fish.audio https://api.deepgram.com",
  // La síntesis de Fish Audio va por el relay del mismo dominio (/api/fish-tts): 'self'
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'constancia-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

/**
 * El relay de Fish Audio (api/fish-tts.ts) es una función de Vercel. En `npm run dev` y `vite preview`
 * este middleware sirve la misma ruta con el mismo código para que la voz funcione también en local.
 */
const fishRelayPlugin = (): Plugin => {
  const middleware = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? ''}`, {
      method: req.method,
      headers,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    });
    const response = await handleFishTts(request);
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return {
    name: 'pilas-fish-relay',
    configureServer: (server) => void server.middlewares.use('/api/fish-tts', middleware),
    configurePreviewServer: (server) => void server.middlewares.use('/api/fish-tts', middleware),
  };
};

export default defineConfig({
  plugins: [react(), cspPlugin(), fishRelayPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Solo en este equipo por defecto. Para probar desde el móvil en la red local: `npm run dev:lan`
    host: 'localhost',
    port: 5173,
    open: false,
  },
  preview: {
    host: 'localhost',
    port: 5173,
  },
});
