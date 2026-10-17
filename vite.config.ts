import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Reenvío local a proveedores de voz que no permiten CORS desde el navegador.
 * Usa las mismas rutas que la función serverless de producción (api/relay.ts): /api/relay/<proveedor>/...
 */
const VOICE_PROVIDERS: Record<string, string> = {
  'fish-audio': 'https://api.fish.audio',
  elevenlabs: 'https://api.elevenlabs.io',
  'openai-tts': 'https://api.openai.com',
  deepgram: 'https://api.deepgram.com',
};

const relayProxy: Record<string, ProxyOptions> = Object.fromEntries(
  Object.entries(VOICE_PROVIDERS).map(([provider, target]) => [
    `/api/relay/${provider}`,
    {
      target,
      changeOrigin: true,
      secure: true,
      rewrite: (path: string) => path.replace(new RegExp(`^/api/relay/${provider}`), ''),
      configure: (proxy) => {
        // Misma marca que la función de producción: el cliente sabe que la respuesta viene del reenvío
        proxy.on('proxyRes', (proxyRes) => {
          proxyRes.headers['x-constancia-relay'] = '1';
        });
      },
    },
  ]),
);

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
  "media-src 'self' blob:",
  "connect-src 'self' https://generativelanguage.googleapis.com https://api.openai.com https://api.groq.com https://openrouter.ai https://api.elevenlabs.io https://api.fish.audio https://api.deepgram.com",
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

export default defineConfig({
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Solo en este equipo por defecto. Para probar desde el móvil en la red local: `npm run dev:lan`
    host: 'localhost',
    port: 5173,
    open: false,
    proxy: relayProxy,
  },
  preview: {
    host: 'localhost',
    port: 5173,
    proxy: relayProxy,
  },
});
