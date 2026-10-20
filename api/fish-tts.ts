import { handleFishTts } from './_fishRelay';

/** Vercel: función Edge (gratuita en el plan Hobby) en /api/fish-tts. Ver _fishRelay.ts */
export const config = { runtime: 'edge' };

export default function handler(req: Request): Promise<Response> {
  return handleFishTts(req);
}
