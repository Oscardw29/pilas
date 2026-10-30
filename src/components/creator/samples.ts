import { adminSaveItem, removeCatalogFiles, uploadCatalogFile } from '@/social/api';
import { canvasToWebp, muxAnimatedWebp, stillFrame } from '@/social/images';
import type { CatalogItem, CatalogKind, Rarity } from '@/social/types';

/**
 * MUESTRAS DEL CATÁLOGO (panel del creador)
 * Se dibujan en el dispositivo con <canvas> y se suben como WebP en **borrador**: nada se ve en la tienda hasta publicarlo.
 * - Banners 1200×400, marcos 256×256 con el centro transparente y tarjetas de ranking 1200×160.
 * - Por tipo: 2 estáticas y 2 animadas (16 fotogramas a 85 ms, unidas con muxAnimatedWebp).
 * - Cada muestra tiene un `sample_key` fijo: si ya está en el catálogo no se vuelve a subir.
 */

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

export interface SampleDef {
  key: string;
  kind: Exclude<CatalogKind, 'reward'>;
  name: string;
  description: string;
  price: number;
  rarity: Rarity;
  animated: boolean;
  draw: Draw;
}

const SIZE: Record<SampleDef['kind'], [number, number]> = { banner: [1200, 400], frame: [256, 256], card: [1200, 160] };
const FRAMES = 16;
const FRAME_MS = 85;
const MAX_BYTES = 2 * 1024 * 1024;
const TAU = Math.PI * 2;

/** Aleatorio con semilla: la misma muestra sale igual cada vez */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stars(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number, t = 0, twinkle = 0) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = r() * h;
    const size = 0.5 + r() * 1.6;
    const phase = r();
    const speed = 1 + Math.floor(r() * 2);
    const base = 0.35 + r() * 0.5;
    const a = twinkle ? base * (1 - twinkle) + twinkle * (0.5 + 0.5 * Math.sin(TAU * (t * speed + phase))) : base;
    ctx.globalAlpha = Math.max(0.05, Math.min(1, a));
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ---------------- Banners ---------------- */

const aurora: Draw = (ctx, w, h) => {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#050816');
  bg.addColorStop(1, '#0b1a33');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  stars(ctx, w, h * 0.8, 160, 7);
  ctx.globalCompositeOperation = 'lighter';
  const bands = [
    { y: 0.42, amp: 46, col: ['rgba(52,211,153,0)', 'rgba(52,211,153,.55)', 'rgba(45,212,191,0)'], k: 1.6, ph: 0 },
    { y: 0.5, amp: 60, col: ['rgba(34,211,238,0)', 'rgba(34,211,238,.4)', 'rgba(56,189,248,0)'], k: 1.1, ph: 1.4 },
    { y: 0.36, amp: 38, col: ['rgba(167,139,250,0)', 'rgba(167,139,250,.45)', 'rgba(244,114,182,0)'], k: 2.2, ph: 2.6 },
  ];
  for (const b of bands) {
    for (let x = 0; x < w; x += 3) {
      const y = h * b.y + Math.sin((x / w) * TAU * b.k + b.ph) * b.amp + Math.sin((x / w) * TAU * 3.3 + b.ph) * 12;
      const len = 90 + 50 * Math.sin((x / w) * TAU * 2 + b.ph);
      const g = ctx.createLinearGradient(0, y - len, 0, y + 20);
      g.addColorStop(0, b.col[0]);
      g.addColorStop(0.75, b.col[1]);
      g.addColorStop(1, b.col[2]);
      ctx.fillStyle = g;
      ctx.fillRect(x, y - len, 3, len + 20);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  const fade = ctx.createLinearGradient(0, h * 0.75, 0, h);
  fade.addColorStop(0, 'rgba(5,8,22,0)');
  fade.addColorStop(1, 'rgba(5,8,22,.9)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
};

const sunset: Draw = (ctx, w, h) => {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1e1b4b');
  sky.addColorStop(0.45, '#7c3aed');
  sky.addColorStop(0.75, '#f97316');
  sky.addColorStop(1, '#fbbf24');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const sun = ctx.createRadialGradient(w * 0.62, h * 0.78, 10, w * 0.62, h * 0.78, 190);
  sun.addColorStop(0, 'rgba(255,247,214,1)');
  sun.addColorStop(0.35, 'rgba(253,224,71,.9)');
  sun.addColorStop(1, 'rgba(253,186,116,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  const layers = [
    { base: 0.72, amp: 50, col: '#6d28d9', seed: 3 },
    { base: 0.82, amp: 40, col: '#4c1d95', seed: 5 },
    { base: 0.92, amp: 30, col: '#2e1065', seed: 9 },
  ];
  for (const l of layers) {
    const r = rng(l.seed);
    ctx.fillStyle = l.col;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 60) ctx.lineTo(x, h * l.base - r() * l.amp);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
};

const constellation: Draw = (ctx, w, h, t) => {
  const bg = ctx.createRadialGradient(w * 0.3, h * 0.2, 20, w * 0.5, h * 0.5, w * 0.7);
  bg.addColorStop(0, '#1e1b4b');
  bg.addColorStop(1, '#030712');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  stars(ctx, w, h, 220, 21, t, 0.8);
  const groups = [
    [[120, 90], [210, 140], [300, 110], [360, 200], [280, 260]],
    [[620, 70], [700, 130], [790, 100], [860, 170], [760, 230], [690, 300]],
    [[980, 220], [1060, 160], [1120, 240], [1050, 320]],
  ];
  ctx.strokeStyle = 'rgba(165,180,252,.35)';
  ctx.lineWidth = 1.5;
  for (const g of groups) {
    ctx.beginPath();
    g.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  groups.flat().forEach(([x, y], i) => {
    const a = 0.55 + 0.45 * Math.sin(TAU * (t + i / 7));
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 14);
    glow.addColorStop(0, `rgba(224,231,255,${a})`);
    glow.addColorStop(1, 'rgba(224,231,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 14, y - 14, 28, 28);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, TAU);
    ctx.fill();
  });
};

const neonWave: Draw = (ctx, w, h, t) => {
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0b0420');
  bg.addColorStop(1, '#140a2e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const waves = [
    { col: '#22d3ee', y: 0.38, amp: 40, k: 2, sp: 1 },
    { col: '#a78bfa', y: 0.5, amp: 55, k: 1, sp: 1 },
    { col: '#f472b6', y: 0.62, amp: 35, k: 3, sp: 2 },
    { col: '#34d399', y: 0.72, amp: 25, k: 2, sp: -1 },
  ];
  ctx.lineCap = 'round';
  for (const wv of waves) {
    const path = () => {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = h * wv.y + Math.sin((x / w) * TAU * wv.k - TAU * t * wv.sp) * wv.amp;
        if (x) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
    };
    ctx.strokeStyle = wv.col;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 16;
    path();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 4;
    path();
    ctx.stroke();
  }
};

/* ---------------- Marcos ---------------- */
// La foto ocupa el círculo central (1/1,36 del lado): el aro va entre ≈ 0,36 y 0,49 del lado

const ring = (ctx: CanvasRenderingContext2D, w: number, inner: number, outer: number, color: (angle: number) => string) => {
  const c = w / 2;
  const steps = 240;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * TAU;
    const a1 = ((i + 1.6) / steps) * TAU;
    ctx.fillStyle = color(a0);
    ctx.beginPath();
    ctx.arc(c, c, outer, a0, a1);
    ctx.arc(c, c, inner, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }
};

const circleLine = (ctx: CanvasRenderingContext2D, w: number, r: number, color: string, width: number) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(w / 2, w / 2, r, 0, TAU);
  ctx.stroke();
};

const gold: Draw = (ctx, w) => {
  const inner = w * 0.365;
  const outer = w * 0.46;
  ring(ctx, w, inner, outer, (a) => `hsl(${40 + 6 * Math.sin(a * 2)}, 90%, ${50 + 18 * Math.sin(a * 3 + 0.6)}%)`);
  circleLine(ctx, w, inner + 1, 'rgba(120,53,15,.9)', 2);
  circleLine(ctx, w, outer - 1, 'rgba(255,251,235,.9)', 2);
  circleLine(ctx, w, (inner + outer) / 2, 'rgba(180,83,9,.45)', 1.5);
  const c = w / 2;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU - Math.PI / 2;
    const x = c + Math.cos(a) * ((inner + outer) / 2);
    const y = c + Math.sin(a) * ((inner + outer) / 2);
    const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 9);
    g.addColorStop(0, '#fef3c7');
    g.addColorStop(0.5, i % 2 ? '#a78bfa' : '#f43f5e');
    g.addColorStop(1, i % 2 ? '#5b21b6' : '#9f1239');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 8.5, 0, TAU);
    ctx.fill();
  }
};

const ice: Draw = (ctx, w) => {
  const c = w / 2;
  const inner = w * 0.365;
  const outer = w * 0.44;
  // Cristales hacia fuera
  const r = rng(11);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + r() * 0.2;
    const len = w * (0.035 + r() * 0.015);
    const half = 0.09 + r() * 0.05;
    const g = ctx.createLinearGradient(c + Math.cos(a) * outer, c + Math.sin(a) * outer, c + Math.cos(a) * (outer + len), c + Math.sin(a) * (outer + len));
    g.addColorStop(0, '#7dd3fc');
    g.addColorStop(1, '#f0f9ff');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a - half) * (outer - 4), c + Math.sin(a - half) * (outer - 4));
    ctx.lineTo(c + Math.cos(a) * Math.min(outer + len, w * 0.49), c + Math.sin(a) * Math.min(outer + len, w * 0.49));
    ctx.lineTo(c + Math.cos(a + half) * (outer - 4), c + Math.sin(a + half) * (outer - 4));
    ctx.closePath();
    ctx.fill();
  }
  ring(ctx, w, inner, outer, (a) => `hsl(${198 + 8 * Math.sin(a * 2)}, 90%, ${62 + 16 * Math.sin(a * 4 + 1)}%)`);
  circleLine(ctx, w, inner + 1, 'rgba(12,74,110,.8)', 2);
  circleLine(ctx, w, outer - 1, 'rgba(240,249,255,.95)', 2);
  // Destellos
  for (let i = 0; i < 6; i++) {
    const a = r() * TAU;
    const rad = inner + (outer - inner) * r();
    const x = c + Math.cos(a) * rad;
    const y = c + Math.sin(a) * rad;
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x + 5, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.stroke();
  }
};

const fire: Draw = (ctx, w, _h, t) => {
  const c = w / 2;
  const inner = w * 0.365;
  const base = w * 0.42;
  const max = w * 0.49;
  ctx.globalCompositeOperation = 'lighter';
  const n = 22;
  const r = rng(31);
  const flames = Array.from({ length: n }, () => ({ ph: r(), sp: 1 + Math.floor(r() * 2), wd: 0.16 + r() * 0.08 }));
  flames.forEach((f, i) => {
    const a = (i / n) * TAU;
    const tall = base + (max - base) * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(TAU * (t * f.sp + f.ph))));
    const sway = 0.06 * Math.sin(TAU * (t + f.ph));
    const tipX = c + Math.cos(a + sway) * tall;
    const tipY = c + Math.sin(a + sway) * tall;
    const g = ctx.createRadialGradient(c + Math.cos(a) * inner, c + Math.sin(a) * inner, 2, c + Math.cos(a) * inner, c + Math.sin(a) * inner, tall - inner + 8);
    g.addColorStop(0, 'rgba(254,240,138,.95)');
    g.addColorStop(0.45, 'rgba(249,115,22,.85)');
    g.addColorStop(1, 'rgba(220,38,38,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a - f.wd) * inner, c + Math.sin(a - f.wd) * inner);
    ctx.quadraticCurveTo(c + Math.cos(a - f.wd * 0.6) * base, c + Math.sin(a - f.wd * 0.6) * base, tipX, tipY);
    ctx.quadraticCurveTo(c + Math.cos(a + f.wd * 0.6) * base, c + Math.sin(a + f.wd * 0.6) * base, c + Math.cos(a + f.wd) * inner, c + Math.sin(a + f.wd) * inner);
    ctx.closePath();
    ctx.fill();
  });
  ctx.globalCompositeOperation = 'source-over';
  ring(ctx, w, inner, w * 0.395, (a) => `hsl(${18 + 10 * Math.sin(a * 3 + TAU * t)}, 95%, ${42 + 10 * Math.sin(a * 5 - TAU * t)}%)`);
  circleLine(ctx, w, inner + 1, 'rgba(127,29,29,.9)', 2);
};

const rainbow: Draw = (ctx, w, _h, t) => {
  const inner = w * 0.365;
  const outer = w * 0.455;
  ring(ctx, w, inner, outer, (a) => `hsl(${((a / TAU) * 360 + t * 360) % 360}, 90%, 60%)`);
  circleLine(ctx, w, inner + 1, 'rgba(255,255,255,.5)', 1.5);
  circleLine(ctx, w, outer - 1, 'rgba(255,255,255,.7)', 1.5);
  const c = w / 2;
  for (let i = 0; i < 3; i++) {
    const a = TAU * (t + i / 3);
    const x = c + Math.cos(a) * ((inner + outer) / 2);
    const y = c + Math.sin(a) * ((inner + outer) / 2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 12, y - 12, 24, 24);
  }
};

/* ---------------- Tarjetas de ranking ---------------- */

const graphite: Draw = (ctx, w, h) => {
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#374151');
  bg.addColorStop(0.5, '#1f2937');
  bg.addColorStop(1, '#111827');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 2;
  for (let x = -h; x < w; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + h, 0);
    ctx.stroke();
  }
  const sheen = ctx.createLinearGradient(w * 0.55, 0, w * 0.8, h);
  sheen.addColorStop(0, 'rgba(255,255,255,0)');
  sheen.addColorStop(0.5, 'rgba(229,231,235,.14)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  ctx.fillRect(0, 0, w, 2);
};

const mint: Draw = (ctx, w, h) => {
  const bg = ctx.createLinearGradient(0, 0, w, 0);
  bg.addColorStop(0, '#064e3b');
  bg.addColorStop(0.6, '#059669');
  bg.addColorStop(1, '#6ee7b7');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const r = rng(17);
  for (let i = 0; i < 26; i++) {
    const x = w * (0.35 + r() * 0.65);
    const y = r() * h;
    const rad = 10 + r() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(236,253,245,${0.12 + r() * 0.22})`);
    g.addColorStop(1, 'rgba(236,253,245,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
};

const galaxy: Draw = (ctx, w, h, t) => {
  ctx.fillStyle = '#05010f';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const blobs = [
    { x: 0.55, y: 0.5, r: 260, col: '124,58,237', a: 0.55, k: 1 },
    { x: 0.78, y: 0.4, r: 200, col: '219,39,119', a: 0.45, k: -1 },
    { x: 0.92, y: 0.65, r: 170, col: '14,165,233', a: 0.45, k: 1 },
  ];
  for (const b of blobs) {
    const x = w * b.x + Math.cos(TAU * t * b.k) * 40;
    const y = h * b.y + Math.sin(TAU * t * b.k) * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, b.r);
    g.addColorStop(0, `rgba(${b.col},${b.a})`);
    g.addColorStop(1, `rgba(${b.col},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalCompositeOperation = 'source-over';
  stars(ctx, w, h, 150, 41, t, 0.9);
};

const pulse: Draw = (ctx, w, h, t) => {
  const bg = ctx.createLinearGradient(0, 0, w, 0);
  bg.addColorStop(0, '#12040a');
  bg.addColorStop(1, '#2a0712');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(244,63,94,.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  // Latido: un patrón de 400 px que se desplaza un periodo entero por vuelta
  const P = 400;
  const mid = h * 0.55;
  const beat = (u: number) => {
    const x = ((u % P) + P) % P;
    if (x < 150 || x > 250) return 0;
    if (x < 170) return -((x - 150) / 20) * 10;
    if (x < 185) return -10 + ((x - 170) / 15) * 70;
    if (x < 200) return 60 - ((x - 185) / 15) * 120;
    if (x < 215) return -60 + ((x - 200) / 15) * 75;
    if (x < 250) return 15 - ((x - 215) / 35) * 15;
    return 0;
  };
  const off = t * P;
  const path = () => {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const y = mid - beat(x + off);
      if (x) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
  };
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(251,113,133,.22)';
  ctx.lineWidth = 12;
  path();
  ctx.stroke();
  ctx.strokeStyle = '#fb7185';
  ctx.lineWidth = 3;
  path();
  ctx.stroke();
};

export const SAMPLES: SampleDef[] = [
  { key: 'banner-aurora', kind: 'banner', name: 'Aurora', description: 'Luces del norte sobre un cielo estrellado.', price: 400, rarity: 'rare', animated: false, draw: aurora },
  { key: 'banner-atardecer', kind: 'banner', name: 'Atardecer', description: 'Montañas violetas y un sol que se despide.', price: 250, rarity: 'common', animated: false, draw: sunset },
  { key: 'banner-constelacion', kind: 'banner', name: 'Constelación', description: 'Estrellas que titilan y forman figuras.', price: 900, rarity: 'epic', animated: true, draw: constellation },
  { key: 'banner-ola-neon', kind: 'banner', name: 'Ola neón', description: 'Ondas de luz que no se detienen.', price: 1500, rarity: 'legendary', animated: true, draw: neonWave },
  { key: 'frame-oro', kind: 'frame', name: 'Oro', description: 'Un aro dorado con gemas.', price: 350, rarity: 'rare', animated: false, draw: gold },
  { key: 'frame-hielo', kind: 'frame', name: 'Hielo', description: 'Cristales de hielo alrededor de tu foto.', price: 200, rarity: 'common', animated: false, draw: ice },
  { key: 'frame-fuego', kind: 'frame', name: 'Fuego', description: 'Llamas vivas para las rachas que arden.', price: 800, rarity: 'epic', animated: true, draw: fire },
  { key: 'frame-arcoiris', kind: 'frame', name: 'Arcoíris', description: 'Todos los colores girando sin parar.', price: 1200, rarity: 'legendary', animated: true, draw: rainbow },
  { key: 'card-grafito', kind: 'card', name: 'Grafito', description: 'Sobria y elegante.', price: 150, rarity: 'common', animated: false, draw: graphite },
  { key: 'card-menta', kind: 'card', name: 'Menta', description: 'Fresca, con destellos suaves.', price: 200, rarity: 'common', animated: false, draw: mint },
  { key: 'card-galaxia', kind: 'card', name: 'Galaxia', description: 'Nebulosas en movimiento detrás de tu nombre.', price: 700, rarity: 'epic', animated: true, draw: galaxy },
  { key: 'card-pulso', kind: 'card', name: 'Pulso', description: 'Un latido constante, como tus hábitos.', price: 600, rarity: 'rare', animated: true, draw: pulse },
];

function canvasFor(def: SampleDef) {
  const [w, h] = SIZE[def.kind];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este dispositivo no puede dibujar las muestras.');
  return { canvas, ctx, w, h };
}

/** Deja respirar a la interfaz entre fotogramas (la barra de progreso sigue viva) */
const idle = () => new Promise<void>((r) => setTimeout(r, 0));

/** Dibuja una muestra: el WebP final (≤ 2 MB) y, si es animada, su fotograma fijo */
export async function renderSample(def: SampleDef): Promise<{ asset: Blob; thumb: Blob | null }> {
  const { canvas, ctx, w, h } = canvasFor(def);
  for (const quality of [0.8, 0.65, 0.5]) {
    let asset: Blob;
    if (!def.animated) {
      ctx.clearRect(0, 0, w, h);
      def.draw(ctx, w, h, 0);
      asset = await canvasToWebp(canvas, quality);
    } else {
      const frames: Blob[] = [];
      for (let i = 0; i < FRAMES; i++) {
        ctx.clearRect(0, 0, w, h);
        def.draw(ctx, w, h, i / FRAMES);
        frames.push(await canvasToWebp(canvas, quality));
        await idle();
      }
      asset = await muxAnimatedWebp(frames, w, h, FRAME_MS);
    }
    if (asset.size <= MAX_BYTES) {
      const thumb = def.animated ? await stillFrame(asset, def.kind === 'frame' ? 256 : 600) : null;
      return { asset, thumb };
    }
  }
  throw new Error(`La muestra «${def.name}» pesa más de 2 MB.`);
}

/**
 * Sube las muestras que faltan como borradores. `onProgress(hechas, total, nombre)`.
 * Si una falla se borran sus archivos y se detiene (lo ya subido se queda).
 */
export async function importSamples(
  existingKeys: Set<string>,
  nextSort: Record<CatalogKind, number>,
  onProgress: (done: number, total: number, name: string) => void,
): Promise<CatalogItem[]> {
  const todo = SAMPLES.filter((s) => !existingKeys.has(s.key));
  const created: CatalogItem[] = [];
  const sort = { ...nextSort };
  for (const [i, def] of todo.entries()) {
    onProgress(i, todo.length, def.name);
    const { asset, thumb } = await renderSample(def);
    const uploaded: string[] = [];
    try {
      const folder = `${def.kind}s`;
      const asset_path = await uploadCatalogFile(folder, asset);
      uploaded.push(asset_path);
      const thumb_path = thumb ? await uploadCatalogFile(folder, thumb) : null;
      if (thumb_path) uploaded.push(thumb_path);
      created.push(
        await adminSaveItem({
          kind: def.kind,
          name: def.name,
          description: def.description,
          price: def.price,
          rarity: def.rarity,
          animated: def.animated,
          asset_path,
          thumb_path,
          icon: null,
          status: 'draft',
          sort: sort[def.kind],
          sample_key: def.key,
        }),
      );
      sort[def.kind] += 10;
    } catch (err) {
      await removeCatalogFiles(uploaded).catch(() => {});
      throw err;
    }
  }
  onProgress(todo.length, todo.length, '');
  return created;
}
