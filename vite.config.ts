import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleFishTts } from './api/_fishRelay';

/**
 * Content-Security-Policy para producción. No se aplica en desarrollo porque el HMR de Vite
 * necesita scripts inline. 'unsafe-inline' en estilos es necesario por los estilos en línea de React.
 * `supabaseOrigin`: el proyecto de Supabase de esta compilación (cuentas y sincronización).
 */
const buildCsp = (supabaseOrigin: string) =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${supabaseOrigin} https://generativelanguage.googleapis.com https://api.openai.com https://api.groq.com https://openrouter.ai https://api.elevenlabs.io https://api.fish.audio https://api.deepgram.com`,
    // La síntesis de Fish Audio va por el relay del mismo dominio (/api/fish-tts): 'self'
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

/**
 * En la web y en Android (Capacitor) el CSP va en un <meta>. En Tauri no: Tauri inyecta su propio CSP
 * (src-tauri/tauri.conf.json) con los orígenes de su IPC, y un <meta> adicional los bloquearía.
 */
const cspPlugin = (csp: string): Plugin => ({
  name: 'pilas-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }],
});

function supabaseOrigin(url?: string): string {
  try {
    return url ? new URL(url).origin : 'https://*.supabase.co';
  } catch {
    return 'https://*.supabase.co';
  }
}

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

  export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const csp = buildCsp(supabaseOrigin(env.VITE_SUPABASE_URL));
    return {
    plugins: [react(), ...(mode === 'tauri' ? [] : [cspPlugin(csp)]), fishRelayPlugin()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      // Solo en este equipo por defecto. Para probar desde el móvil en la red local: `npm run dev:lan`.
      // Ojo: dev:lan también expone el reenvío de voz a toda la red; úsalo solo en redes de confianza.
      host: 'localhost',
      port: 5173,
      open: false,
    },
    preview: {
      host: 'localhost',
      port: 5173,
    },
  };
});
