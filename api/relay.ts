/**
 * Reenvío SIN ESTADO hacia proveedores de voz que no permiten CORS desde el navegador.
 * - Solo reenvía a una lista blanca de hosts fijos (no es un proxy abierto).
 * - La clave de API viaja en la cabecera de la petición del usuario: no se guarda ni se registra.
 * - Ruta pública: /api/relay/<proveedor>/<ruta>  (ver rewrite en vercel.json)
 */
export const config = { runtime: 'edge' };

const PROVIDERS: Record<string, string> = {
  'fish-audio': 'https://api.fish.audio',
  elevenlabs: 'https://api.elevenlabs.io',
  'openai-tts': 'https://api.openai.com',
  deepgram: 'https://api.deepgram.com',
};

/** Cabeceras que se reenvían al proveedor (todo lo demás, incluidas cookies, se descarta) */
const FORWARDED_HEADERS = ['authorization', 'xi-api-key', 'content-type', 'accept', 'model'];

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') ?? '';
  const path = url.searchParams.get('path') ?? '';
  const base = PROVIDERS[provider];
  if (!base || !/^[\w\-./]*$/.test(path) || path.includes('..')) {
    return new Response('Proveedor o ruta no permitidos', { status: 400 });
  }

  const upstreamParams = new URLSearchParams(url.searchParams);
  upstreamParams.delete('provider');
  upstreamParams.delete('path');
  const query = upstreamParams.toString();
  const target = `${base}/${path}${query ? `?${query}` : ''}`;

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
