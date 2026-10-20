import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

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
  "connect-src 'self' https://generativelanguage.googleapis.com https://api.openai.com https://api.groq.com https://openrouter.ai",
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
  },
  preview: {
    host: 'localhost',
    port: 5173,
  },
});
