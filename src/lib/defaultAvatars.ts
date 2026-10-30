/**
 * FOTOS DE PERFIL POR DEFECTO
 * Cinco ilustraciones con la idea de la app (la pila con su rayo, la racha, el hábito cumplido, el brote que crece y la
 * cima alcanzada). La bienvenida propone una y se puede cambiar (se guarda en `settings.avatarPreset`). Sin elegida, la
 * foto por defecto sale de la cuenta (`effectivePreset`): la misma en todos los dispositivos sin escribir los ajustes.
 * No se suben al servidor: el perfil público guarda `default:N` y cada dispositivo dibuja la suya.
 */

export type DefaultAvatarId = 1 | 2 | 3 | 4 | 5;

const svg = (body: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${body}</svg>`)}`;

const grad = (id: string, from: string, to: string, vertical = false) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;

export const DEFAULT_AVATARS: { id: DefaultAvatarId; label: string; src: string }[] = [
  {
    id: 1,
    label: 'Pila',
    src: svg(
      `<defs>${grad('g', '#a78bfa', '#5b21b6')}${grad('b', '#fde047', '#f59e0b', true)}</defs>` +
        '<rect width="128" height="128" fill="url(#g)"/>' +
        '<g transform="rotate(12 64 66)">' +
        '<rect x="55" y="25" width="18" height="10" rx="3.5" fill="#fff"/>' +
        '<rect x="41" y="32" width="46" height="68" rx="13" fill="#fff"/>' +
        '<path d="M69 40 L50 70 H61.5 L57 92 L77 60 H65.5 Z" fill="url(#b)" stroke="#b45309" stroke-width="1.6" stroke-linejoin="round"/>' +
        '</g>',
    ),
  },
  {
    id: 2,
    label: 'Racha',
    src: svg(
      `<defs>${grad('g', '#fdba74', '#c2410c')}${grad('f', '#fde047', '#f97316', true)}</defs>` +
        '<rect width="128" height="128" fill="url(#g)"/>' +
        '<path d="M64 22 C71 40 90 50 90 75 C90 92 78 104 64 104 C50 104 38 92 38 75 C38 62 45 53 52 47 C52 58 56 64 61 66 C58 51 60 35 64 22 Z" fill="#fff7ed"/>' +
        '<path d="M64 58 C69 67 77 73 77 85 C77 93 71 99 64 99 C57 99 51 93 51 85 C51 78 55 72 60 69 C60 75 62 79 66 80 C63 72 62 65 64 58 Z" fill="url(#f)"/>',
    ),
  },
  {
    id: 3,
    label: 'Cumplido',
    src: svg(
      `<defs>${grad('g', '#7dd3fc', '#1d4ed8')}</defs>` +
        '<rect width="128" height="128" fill="url(#g)"/>' +
        '<circle cx="64" cy="64" r="36" fill="#fff"/>' +
        '<path d="M47 65 L59 77 L82 52" fill="none" stroke="#2563eb" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>',
    ),
  },
  {
    id: 4,
    label: 'Brote',
    src: svg(
      `<defs>${grad('g', '#86efac', '#15803d')}</defs>` +
        '<rect width="128" height="128" fill="url(#g)"/>' +
        '<ellipse cx="64" cy="101" rx="24" ry="5.5" fill="#14532d" opacity=".3"/>' +
        '<path d="M64 100 V60" stroke="#fff" stroke-width="7" stroke-linecap="round"/>' +
        '<path d="M63 68 C63 49 50 38 31 38 C31 57 44 68 63 68 Z" fill="#fff"/>' +
        '<path d="M65 61 C65 42 78 29 97 29 C97 50 84 61 65 61 Z" fill="#dcfce7"/>',
    ),
  },
  {
    id: 5,
    label: 'Cima',
    src: svg(
      `<defs>${grad('g', '#f9a8d4', '#be185d')}</defs>` +
        '<rect width="128" height="128" fill="url(#g)"/>' +
        '<path d="M80 54 V25" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>' +
        '<path d="M81 26 L100 33 L81 40 Z" fill="#fde047"/>' +
        '<path d="M20 100 L53 50 L66 68 L80 52 L108 100 Z" fill="#fff"/>' +
        '<path d="M53 50 L62 63 L56 61 L49 66 L45 62 Z" fill="#fce7f3"/>',
    ),
  },
];

const isId = (n: unknown): n is DefaultAvatarId => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= DEFAULT_AVATARS.length;

export const defaultAvatarSrc = (n: number | null | undefined) => (isId(n) ? DEFAULT_AVATARS[n - 1].src : undefined);

export const randomDefaultAvatar = (): DefaultAvatarId => (Math.floor(Math.random() * DEFAULT_AVATARS.length) + 1) as DefaultAvatarId;

/** Huella corta y estable de un texto (FNV-1a de 32 bits): no es criptográfica, solo para comparar o repartir */
export function textHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Foto por defecto que se ve: la elegida (`settings.avatarPreset`) si es válida o, si no, una fija derivada de `seed`
 * (el id de la cuenta). Así no hace falta guardar una al azar en los ajustes: escribirlos al cargar desde un dispositivo
 * desfasado pisaba los ajustes más nuevos de otro (los ajustes se sincronizan enteros).
 */
export const effectivePreset = (preset: number | null | undefined, seed: string): DefaultAvatarId =>
  isId(preset) ? preset : (((textHash(seed) % DEFAULT_AVATARS.length) + 1) as DefaultAvatarId);

/** Ruta que guarda el perfil público para una foto por defecto */
export const defaultAvatarPath = (n: DefaultAvatarId) => `default:${n}`;

/** `default:3` → 3 (o null si es una foto subida) */
export const parseDefaultAvatarPath = (path: string | null | undefined): DefaultAvatarId | null => {
  const m = /^default:([1-9])$/.exec(path ?? '');
  const n = m ? Number(m[1]) : NaN;
  return isId(n) ? n : null;
};
