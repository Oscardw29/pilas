import React, { useEffect, useRef } from 'react';

export type VisualizerState = 'listening' | 'speaking' | 'thinking' | 'idle' | 'muted';

interface VoiceVisualizerProps {
  state: VisualizerState;
  /** Analizador con el audio que toca mostrar (micrófono al escuchar, voz del asistente al hablar) */
  getAnalyser: () => AnalyserNode | null;
  /** Impulsos 0-1 por palabra cuando la voz es la nativa del navegador (no da audio analizable) */
  pulseRef: React.MutableRefObject<number>;
  onActivate?: () => void;
  label: string;
}

/**
 * ANILLO DE VOZ
 * Barras radiales segmentadas que nacen de un anillo de puntos, con brillo aditivo.
 * Colores de la marca: violeta para el asistente, cian para el usuario; el resto del tiempo conviven alrededor del anillo.
 * Las barras siguen bandas de frecuencia reales repartidas por el círculo, con picos suaves y asimétricos.
 */

const BARS = 112;
const BANDS = 18;
const CYAN: RGB = [34, 211, 238];
const VIOLET: RGB = [167, 139, 250];
const ORCHID: RGB = [192, 132, 252];
const GREY: RGB = [120, 120, 136];
type RGB = [number, number, number];

/** Orden fijo y desordenado de las bandas alrededor del anillo: los picos no quedan agrupados por frecuencia */
const BAND_ORDER = [0, 9, 4, 13, 2, 16, 7, 11, 1, 14, 5, 17, 8, 3, 12, 6, 15, 10];
const ANCHORS = BAND_ORDER.map((_, slot) => (slot / BANDS) * BARS + 1.7 * Math.sin(slot * 2.3));

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({ state, getAnalyser, pulseRef, onActivate, label }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const getAnalyserRef = useRef(getAnalyser);
  getAnalyserRef.current = getAnalyser;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let size = 0;
    let dpr = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = Math.max(1, Math.round(rect.width));
      canvas.width = size * dpr;
      canvas.height = size * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const bands = new Float32Array(BANDS);
    const target = new Float32Array(BANDS);
    const values = new Float32Array(BARS);
    let freq: Uint8Array<ArrayBuffer> | null = null;
    let tint = 0; // -1 cian (usuario) … +1 violeta (asistente)
    let muteFade = 0;
    let level = 0;
    let t = 0;
    let raf = 0;
    let last = performance.now();

    const readAudio = (analyser: AnalyserNode | null): boolean => {
      if (!analyser) return false;
      if (!freq || freq.length !== analyser.frequencyBinCount) freq = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freq);
      const binHz = analyser.context.sampleRate / analyser.fftSize;
      let energy = 0;
      for (let b = 0; b < BANDS; b++) {
        // Bandas logarítmicas de 140 Hz a 6 kHz: el rango donde vive la voz
        const lo = 140 * Math.pow(6000 / 140, b / BANDS);
        const hi = 140 * Math.pow(6000 / 140, (b + 1) / BANDS);
        const i0 = Math.max(1, Math.floor(lo / binHz));
        const i1 = Math.max(i0 + 1, Math.ceil(hi / binHz));
        let sum = 0;
        for (let i = i0; i < i1 && i < freq.length; i++) sum += freq[i];
        const v = sum / ((i1 - i0) * 255);
        // Puerta de ruido + curva: silencio plano, voz con picos marcados
        target[b] = Math.pow(clamp01((v - 0.2) / 0.6), 1.35);
        energy += target[b];
      }
      return energy / BANDS > 0.015;
    };

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += reduceMotion ? dt * 0.35 : dt;
      const st = stateRef.current;

      // 1. Objetivo de cada banda según el estado y el audio disponible
      const analyser = st === 'listening' || st === 'speaking' ? getAnalyserRef.current() : null;
      const hasAudio = readAudio(analyser);
      if (!hasAudio) {
        const pulse = pulseRef.current;
        pulseRef.current = pulse * Math.pow(0.04, dt); // decae en ~1 s
        for (let b = 0; b < BANDS; b++) {
          if (st === 'speaking') {
            const wobble = 0.5 + 0.5 * Math.sin(t * 7.3 + b * 2.1) * Math.sin(t * 3.1 + b * 1.3);
            target[b] = 0.1 + 0.08 * Math.sin(t * 4.2 + b) + pulse * (0.35 + 0.6 * wobble);
          } else {
            target[b] = 0;
          }
        }
      }

      let sumBands = 0;
      for (let b = 0; b < BANDS; b++) {
        const k = target[b] > bands[b] ? 0.5 : 0.11; // sube rápido, cae despacio
        bands[b] += (target[b] - bands[b]) * k;
        sumBands += bands[b];
      }
      level += (sumBands / BANDS - level) * 0.15;

      const wantTint = st === 'listening' ? -1 : st === 'speaking' ? 1 : 0;
      tint += (wantTint - tint) * Math.min(1, dt * 3);
      muteFade += ((st === 'muted' ? 1 : 0) - muteFade) * Math.min(1, dt * 5);

      // 2. Valor de cada barra: suma de picos triangulares centrados en el ancla de cada banda
      const width = (BARS / BANDS) * 1.3;
      const comet = reduceMotion ? 0 : t * 2.6;
      for (let i = 0; i < BARS; i++) {
        let v = 0;
        for (let s = 0; s < BANDS; s++) {
          let d = Math.abs(i - ANCHORS[s]);
          if (d > BARS / 2) d = BARS - d;
          if (d < width) v += bands[BAND_ORDER[s]] * Math.pow(1 - d / width, 1.6);
        }
        const angle = (i / BARS) * Math.PI * 2;
        if (st === 'thinking') {
          // Cometa que recorre el anillo mientras el asistente piensa
          let d = ((angle - comet) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          d = Math.PI * 2 - d; // la estela queda detrás
          v = Math.max(v, Math.pow(clamp01(1 - d / 1.4), 2.2) * 0.42);
        } else if (st !== 'muted') {
          // Respiración mínima: el anillo nunca parece apagado
          v = Math.max(v, 0.035 + 0.03 * (0.5 + 0.5 * Math.sin(angle * 3 - t * 1.6)));
        }
        values[i] = clamp01(v);
      }

      // 3. Dibujo
      const S = size * dpr;
      const cx = S / 2;
      const cy = S / 2;
      const R = S * 0.27 * (1 + level * 0.035);
      const maxLen = S * 0.2;
      const gap = S * 0.024;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.globalCompositeOperation = 'lighter';

      const stateColor = mix(mix(VIOLET, CYAN, clamp01(-tint)), GREY, muteFade);
      // Halo interior
      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.05);
      glow.addColorStop(0, rgba(stateColor, 0));
      glow.addColorStop(0.75, rgba(stateColor, (0.03 + level * 0.18) * (1 - muteFade)));
      glow.addColorStop(1, rgba(stateColor, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
      ctx.fill();

      const rot = reduceMotion ? 0 : t * 0.18;
      const dotR = Math.max(1, S * 0.0062);
      const seg = Math.max(1.5, S * 0.0075);
      const segGap = Math.max(1, S * 0.0055);
      ctx.lineCap = 'butt';

      for (let i = 0; i < BARS; i++) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const v = values[i];
        // Reparto de color alrededor del anillo (dos lóbulos cian y dos violeta), desplazado por el estado
        const m = clamp01(0.5 + 0.5 * Math.sin(angle * 2 + rot) + tint * 0.42);
        let color = mix(CYAN, m > 0.5 ? mix(VIOLET, ORCHID, (m - 0.5) * 2) : VIOLET, m);
        color = mix(color, GREY, muteFade);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // Punto del anillo base
        ctx.fillStyle = rgba(color, (0.42 + v * 0.9) * (1 - muteFade * 0.45));
        ctx.beginPath();
        ctx.arc(cx + cos * R, cy + sin * R, dotR, 0, Math.PI * 2);
        ctx.fill();

        const len = v * maxLen * (1 - muteFade);
        if (len < seg) continue;
        const x1 = cx + cos * (R + gap);
        const y1 = cy + sin * (R + gap);
        const x2 = cx + cos * (R + gap + len);
        const y2 = cy + sin * (R + gap + len);

        // Brillo difuso (trazo ancho y tenue)
        ctx.setLineDash([]);
        ctx.lineWidth = S * 0.02;
        ctx.strokeStyle = rgba(color, 0.05 + v * 0.13);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Núcleo segmentado que se desvanece hacia la punta
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, rgba(color, 0.95));
        grad.addColorStop(1, rgba(color, 0.12));
        ctx.setLineDash([seg, segGap]);
        ctx.lineWidth = S * 0.0078;
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = 'source-over';

      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [pulseRef]);

  return (
    <button type="button" className={`voice-orb is-${state}`} onClick={onActivate} aria-label={label} disabled={!onActivate}>
      <canvas ref={canvasRef} aria-hidden="true" />
    </button>
  );
};
