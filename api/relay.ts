/**
 * Reenvío SIN ESTADO hacia proveedores de voz que no permiten CORS desde el navegador.
 * - Solo reenvía a una lista blanca de hosts Y rutas fijas (no es un proxy abierto).
 * - Solo acepta peticiones del propio origen de la app (cabecera Origin) y cuerpos acotados.
 * - La clave de API viaja en la cabecera de la petición del usuario: no se guarda ni se registra.
 * - Ruta pública: /api/relay/<proveedor>/<ruta>  (ver rewrite en vercel.json)
 */
export const config = { runtime: 'edge' };

interface ProviderRule {
  base: string;
  /** Rutas exactas que usa la app (sin barra inicial) */
  path: RegExp;
  /** Parámetros de consulta permitidos; el resto se descarta */
  query?: string[];
}

const PROVIDERS: Record<string, ProviderRule> = {
  'fish-audio': { base: 'https://api.fish.audio', path: /^v1\/tts$/ },
  elevenlabs: { base: 'https://api.elevenlabs.io', path: /^v1\/text-to-speech\/[A-Za-z0-9_-]{1,64}$/ },
  'openai-tts': { base: 'https://api.openai.com', path: /^v1\/audio\/speech$/ },
  deepgram: { base: 'https://api.deepgram.com', path: /^v1\/listen$/, query: ['model', 'language', 'smart_format', 'punctuate'] },
};

/** Límite del cuerpo (audio de dictado o texto a sintetizar) */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Cabeceras que se reenvían al proveedor (todo lo demás, incluidas cookies, se descarta) */
const FORWARDED_HEADERS = ['authorization', 'xi-api-key', 'content-type', 'accept', 'model'];

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const url = new URL(request.url);

  // Solo la propia app: evita que otras webs usen este reenvío desde el navegador de sus visitantes
  if (request.headers.get('origin') !== url.origin) {
    return new Response('Origen no permitido', { status: 403 });
  }

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    return new Response('Cuerpo demasiado grande', { status: 413 });
  }

  const provider = url.searchParams.get('provider') ?? '';
  const path = url.searchParams.get('path') ?? '';
  const rule = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : undefined;
  if (!rule || !rule.path.test(path)) {
    return new Response('Proveedor o ruta no permitidos', { status: 400 });
  }

  const upstreamParams = new URLSearchParams();
  for (const key of rule.query ?? []) {
    const value = url.searchParams.get(key);
    if (value !== null) upstreamParams.set(key, value);
  }
  const query = upstreamParams.toString();
  const target = `${rule.base}/${path}${query ? `?${query}` : ''}`;

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(target, { method: 'POST', headers, body: request.body, duplex: 'half' } as RequestInit);

  const responseHeaders = new Headers({ 'x-constancia-relay': '1', 'Cache-Control': 'no-store' });
  const contentType = upstream.headers.get('content-type');
  if (contentType) responseHeaders.set('content-type', contentType);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
