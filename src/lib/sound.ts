import { useStore } from '@/store/useStore';

/**
 * MOTOR DE SONIDOS PROCEDURALES (Web Audio API)
 * Genera los sonidos al vuelo, sin archivos de audio. Todo pasa por un compresor (evita saturar
 * cuando se solapan) y los sonidos de celebración llevan una cola de reverberación sintética.
 */

interface FilterOpts {
  type: BiquadFilterType;
  freq: number;
  /** Barrido del filtro hasta esta frecuencia al final del sonido */
  to?: number;
  q?: number;
}

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  /** Deslizamiento de tono hasta esta frecuencia */
  to?: number;
  /** Duración del deslizamiento (por defecto, toda la nota) */
  glide?: number;
  /** Segundos desde ahora */
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  detune?: number;
  filter?: FilterOpts;
  /** Cantidad enviada a la reverberación (0-1) */
  reverb?: number;
}

interface NoiseOpts {
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  filter: FilterOpts;
  reverb?: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;
      compressor.connect(ctx.destination);

      const master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(compressor);

      // Reverberación: respuesta al impulso sintética (ruido con caída exponencial, estéreo)
      const convolver = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 2.2);
      const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      convolver.buffer = impulse;
      const reverbBus = ctx.createGain();
      reverbBus.gain.value = 0.55;
      reverbBus.connect(convolver);
      convolver.connect(master);

      // Ruido blanco reutilizable (1 s)
      const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const nd = noise.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

      this.ctx = ctx;
      this.masterGain = master;
      this.reverbBus = reverbBus;
      this.noiseBuffer = noise;
    } catch {
      // AudioContext no soportado en este entorno
    }
  }

  private isEnabled(): boolean {
    const settings = useStore.getState().settings;
    if (settings && typeof settings.soundEnabled === 'boolean') {
      return settings.soundEnabled;
    }
    return true;
  }

  private getVolume(): number {
    const settings = useStore.getState().settings;
    return typeof settings?.soundVolume === 'number' ? settings.soundVolume : 0.6;
  }

  /** Prepara el contexto; devuelve false si el sonido está desactivado o no hay audio */
  private ready(): boolean {
    if (!this.isEnabled()) return false;
    this.init();
    return Boolean(this.ctx && this.masterGain);
  }

  private route(node: AudioNode, reverb = 0) {
    node.connect(this.masterGain!);
    if (reverb > 0 && this.reverbBus && this.ctx) {
      const send = this.ctx.createGain();
      send.gain.value = reverb;
      node.connect(send);
      send.connect(this.reverbBus);
    }
  }

  private applyFilter(input: AudioNode, f: FilterOpts, start: number, end: number): AudioNode {
    const filter = this.ctx!.createBiquadFilter();
    filter.type = f.type;
    filter.frequency.setValueAtTime(f.freq, start);
    if (f.to) filter.frequency.exponentialRampToValueAtTime(f.to, end);
    if (f.q != null) filter.Q.value = f.q;
    input.connect(filter);
    return filter;
  }

  /** Una nota con envolvente suave (sin clics) */
  private tone(o: ToneOpts) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.at ?? 0);
    const end = t + o.dur;
    const vol = this.getVolume();

    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide ?? o.dur));
    if (o.detune) osc.detune.value = o.detune;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(o.gain * vol, t + (o.attack ?? 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    const src: AudioNode = o.filter ? this.applyFilter(osc, o.filter, t, end) : osc;
    src.connect(gain);
    this.route(gain, o.reverb);
    osc.start(t);
    osc.stop(end + 0.02);
  }

  /** Ráfaga de ruido filtrado (soplidos, chispas, impactos) */
  private noise(o: NoiseOpts) {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) return;
    const t = ctx.currentTime + (o.at ?? 0);
    const end = t + o.dur;
    const vol = this.getVolume();

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filtered = this.applyFilter(src, o.filter, t, end);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(o.gain * vol, t + (o.attack ?? 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    filtered.connect(gain);
    this.route(gain, o.reverb);
    src.start(t, Math.random() * 0.5);
    src.stop(end + 0.02);
  }

  private play(fn: () => void) {
    if (!this.ready()) return;
    try {
      fn();
    } catch {
      // Ignorar fallos de audio puntuales
    }
  }

  /* ===================== Interfaz ===================== */

  /** Clic táctil suave para botones (~20 ms) */
  public click() {
    this.play(() => this.tone({ freq: 620, to: 320, glide: 0.022, dur: 0.022, gain: 0.12, attack: 0.003 }));
  }

  /** Pop ligero para chips o selecciones */
  public pop() {
    this.play(() => this.tone({ freq: 440, to: 780, glide: 0.035, dur: 0.04, gain: 0.14, attack: 0.005 }));
  }

  /** Toggle / checkbox */
  public toggle() {
    this.play(() => this.tone({ freq: 500, to: 700, glide: 0.018, dur: 0.02, gain: 0.1, attack: 0.003 }));
  }

  /** Apertura de modal: armónico ascendente y etéreo */
  public modalOpen() {
    this.play(() => {
      this.tone({ freq: 340, to: 560, glide: 0.09, dur: 0.12, gain: 0.11, attack: 0.02 });
      this.tone({ type: 'triangle', freq: 520, to: 860, glide: 0.08, dur: 0.11, gain: 0.04, attack: 0.025 });
    });
  }

  /** Cierre de modal con la X o Cancelar: descendente y conclusivo */
  public modalClose() {
    this.play(() => this.tone({ freq: 460, to: 220, glide: 0.075, dur: 0.08, gain: 0.09, attack: 0.01 }));
  }

  /**
   * Clic fuera de un modal que lo cierra: un «fuuu» de aire que se aleja
   * (ruido con barrido descendente + tono grave que se desvanece). Distinto del cierre con la X.
   */
  public dismiss() {
    this.play(() => {
      this.noise({ dur: 0.22, gain: 0.16, attack: 0.025, filter: { type: 'bandpass', freq: 2600, to: 420, q: 1.4 } });
      this.tone({ freq: 392, to: 196, dur: 0.2, gain: 0.07, attack: 0.012 });
      this.tone({ type: 'triangle', freq: 784, to: 392, dur: 0.12, gain: 0.025, attack: 0.01 });
    });
  }

  /**
   * Modal que no se puede cerrar con un clic fuera: «toc-toc» apagado, como golpear una puerta.
   * Más amable que el zumbido anterior, pero claramente un «no».
   */
  public blocked() {
    this.play(() => {
      [0, 0.1].forEach((at, i) => {
        this.tone({
          type: 'triangle',
          freq: i === 0 ? 220 : 165,
          to: i === 0 ? 150 : 110,
          at,
          dur: 0.09,
          gain: 0.2,
          attack: 0.003,
          filter: { type: 'lowpass', freq: 900, q: 0.7 },
        });
        this.noise({ at, dur: 0.03, gain: 0.05, attack: 0.002, filter: { type: 'lowpass', freq: 1800 } });
      });
    });
  }

  /** Alias histórico: algunos componentes llaman a error() al intentar salir de un modal bloqueado */
  public error() {
    this.blocked();
  }

  /** Completar un hábito: doble campanada cristalina (Mi5 → Si5) */
  public complete() {
    this.play(() => {
      this.tone({ freq: 659.25, dur: 0.16, gain: 0.18, attack: 0.015 });
      this.tone({ freq: 987.77, at: 0.07, dur: 0.28, gain: 0.2, attack: 0.015, reverb: 0.15 });
    });
  }

  /** Logro genérico (bienvenida, respaldo restaurado…): acorde ascendente Do5-Mi5-Sol5-Do6 */
  public celebration() {
    this.play(() => {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i, arr) =>
        this.tone({ type: i === arr.length - 1 ? 'sine' : 'triangle', freq, at: i * 0.055, dur: 0.35, gain: 0.14, attack: 0.012, reverb: 0.2 }),
      );
    });
  }

  /**
   * RACHA ENCENDIDA: «chispa que prende»: soplido ascendente del fuego al encenderse,
   * crepitar de chispas y un acorde cálido (Mi mayor) que florece.
   */
  public streak() {
    this.play(() => {
      // Ignición: ruido que sube de grave a agudo
      this.noise({ dur: 0.42, gain: 0.2, attack: 0.18, filter: { type: 'bandpass', freq: 260, to: 3200, q: 0.9 }, reverb: 0.2 });
      // Crepitar: chispas cortas aleatorias
      for (let i = 0; i < 7; i++) {
        this.noise({ at: 0.18 + i * 0.07 + Math.random() * 0.04, dur: 0.025, gain: 0.08, attack: 0.002, filter: { type: 'highpass', freq: 3500 + Math.random() * 2500 } });
      }
      // Flor de acorde cálido: Mi4 Sol#4 Si4 Mi5 (+ Si5 brillante al final)
      [329.63, 415.3, 493.88, 659.25, 987.77].forEach((freq, i) =>
        this.tone({ type: i < 4 ? 'triangle' : 'sine', freq, at: 0.3 + i * 0.06, dur: 0.9 - i * 0.05, gain: i < 4 ? 0.11 : 0.13, attack: 0.02, reverb: 0.35 }),
      );
      // Cuerpo grave que sostiene
      this.tone({ freq: 164.81, at: 0.3, dur: 0.8, gain: 0.1, attack: 0.04, reverb: 0.2 });
    });
  }

  /**
   * SÚPER RACHA: más llamativa. Subida de tensión (barrido), impacto con sub-grave,
   * acorde de metales (Re mayor con sierras desafinadas) y lluvia de destellos en cascada.
   */
  public superStreak() {
    this.play(() => {
      // 1. Riser: sierra filtrada que sube + ruido creciente (0 → 0.5 s)
      this.tone({ type: 'sawtooth', freq: 110, to: 440, dur: 0.5, gain: 0.07, attack: 0.4, filter: { type: 'lowpass', freq: 300, to: 4000, q: 4 } });
      this.noise({ dur: 0.5, gain: 0.12, attack: 0.45, filter: { type: 'highpass', freq: 600, to: 6000 } });

      const hit = 0.5;
      // 2. Impacto: sub-grave y golpe de ruido
      this.tone({ freq: 90, to: 38, at: hit, dur: 0.6, gain: 0.32, attack: 0.004 });
      this.noise({ at: hit, dur: 0.35, gain: 0.18, attack: 0.003, filter: { type: 'lowpass', freq: 5000, to: 400 }, reverb: 0.4 });

      // 3. Acorde de metales: Re3 La3 Re4 Fa#4 La4 Re5, dos sierras desafinadas por nota
      [146.83, 220, 293.66, 369.99, 440, 587.33].forEach((freq) => {
        [-9, 9].forEach((detune) =>
          this.tone({
            type: 'sawtooth',
            freq,
            detune,
            at: hit,
            dur: 1.3,
            gain: 0.035,
            attack: 0.02,
            filter: { type: 'lowpass', freq: 3200, to: 700, q: 1.2 },
            reverb: 0.45,
          }),
        );
      });

      // 4. Cascada de destellos: Re6 Fa#6 La6 Re7 Fa#7 La7
      [1174.66, 1479.98, 1760, 2349.32, 2959.96, 3520].forEach((freq, i) =>
        this.tone({ freq, at: hit + 0.12 + i * 0.075, dur: 0.6, gain: 0.07, attack: 0.006, reverb: 0.6 }),
      );
      // Eco final: arpegio descendente suave que cierra la fanfarria
      [2349.32, 1760, 1479.98, 1174.66].forEach((freq, i) =>
        this.tone({ type: 'triangle', freq, at: hit + 0.75 + i * 0.09, dur: 0.5, gain: 0.04, attack: 0.01, reverb: 0.7 }),
      );
    });
  }

  /** Objetivo completado: triunfal y brillante */
  public goalComplete() {
    this.play(() => {
      [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((freq, i) =>
        this.tone({ type: 'triangle', freq, at: i * 0.065, dur: 0.4, gain: 0.16, attack: 0.015, reverb: 0.25 }),
      );
    });
  }

  /** Borrar / eliminar: chasquido grave y rápido */
  public delete() {
    this.play(() => this.tone({ type: 'sawtooth', freq: 260, to: 75, glide: 0.065, dur: 0.07, gain: 0.12, attack: 0.004 }));
  }

  /** Advertencia: doble tono suave */
  public warning() {
    this.play(() => {
      [0, 0.08].forEach((at) => this.tone({ type: 'triangle', freq: 340, to: 260, glide: 0.05, at, dur: 0.06, gain: 0.12, attack: 0.006 }));
    });
  }

  /** Energía del día: cada nivel más agudo, del 1 al 5 */
  public energy(level: 1 | 2 | 3 | 4 | 5) {
    const freqs = { 1: 220, 2: 330, 3: 440, 4: 587.33, 5: 880 };
    const freq = freqs[level] || 440;
    this.play(() =>
      this.tone({ type: level >= 4 ? 'triangle' : 'sine', freq, to: freq * 1.15, glide: 0.045, dur: 0.09, gain: 0.15, attack: 0.006 }),
    );
  }

  /** Tic-tac del temporizador: 5 pares que se van apagando */
  public startTimerCountdown() {
    this.play(() => {
      for (let sec = 0; sec < 5; sec++) {
        const decay = Math.max(0.08, 1.0 - sec * 0.19);
        this.tone({ type: 'triangle', freq: 1180, to: 540, glide: 0.02, at: sec, dur: 0.024, gain: 0.13 * decay, attack: 0.003 });
        this.tone({ freq: 680, to: 310, glide: 0.022, at: sec + 0.36, dur: 0.028, gain: 0.11 * decay, attack: 0.003 });
      }
    });
  }

  /** Protector de racha: viento helado y campanas de escarcha */
  public freeze() {
    this.play(() => {
      this.noise({ dur: 0.32, gain: 0.18, attack: 0.03, filter: { type: 'bandpass', freq: 3200, to: 800, q: 6 } });
      [1046.5, 1318.5, 1567.98, 1975.53, 2093.0].forEach((freq, i) =>
        this.tone({ freq, to: freq * 1.01, at: i * 0.045, dur: 0.5, gain: 0.12, attack: 0.02, reverb: 0.4 }),
      );
    });
  }

  /** Regalo que aterriza: golpe sordo y suave de caja de cartón */
  public giftLand() {
    this.play(() => {
      this.tone({ type: 'triangle', freq: 150, to: 72, dur: 0.2, gain: 0.2, attack: 0.004, filter: { type: 'lowpass', freq: 650 } });
      this.noise({ dur: 0.06, gain: 0.06, attack: 0.002, filter: { type: 'lowpass', freq: 900 } });
    });
  }

  /**
   * Saltito del regalo antes de abrirse (1, 2 y 3, cada uno más intenso): toc de cartón, roce de
   * papel y una nota que sube (Mi5 → Sol5 → Si5) y resuelve en el Do de la apertura.
   */
  public giftShake(step: 1 | 2 | 3) {
    this.play(() => {
      const k = 0.55 + step * 0.22;
      const knocks = step === 3 ? [0, 0.07, 0.15] : [0, 0.08];
      knocks.forEach((at, i) =>
        this.tone({
          type: 'triangle',
          freq: 190 + step * 22 - i * 12,
          to: 120 + step * 14,
          at,
          dur: 0.06,
          gain: 0.11 * k,
          attack: 0.003,
          filter: { type: 'lowpass', freq: 1100 },
        }),
      );
      // Roce del papel de regalo
      this.noise({ at: 0.02, dur: 0.07, gain: 0.04 * k, attack: 0.01, filter: { type: 'bandpass', freq: 3200, q: 0.8 } });
      // Nota de expectativa
      this.tone({ freq: [659.25, 783.99, 987.77][step - 1], at: 0.05, dur: 0.28, gain: 0.03 + step * 0.012, attack: 0.02, reverb: 0.3 });
    });
  }

  /** Canje de recompensa: el regalo se abre (pop de la tapa, soplo de aire, arpegio mágico y monedas) */
  public redeemReward() {
    this.play(() => {
      // Pop de la tapa
      this.tone({ type: 'square', freq: 1800, to: 900, glide: 0.02, dur: 0.025, gain: 0.05, attack: 0.002, filter: { type: 'lowpass', freq: 4000 } });
      // Barrido de aire ascendente
      this.noise({ at: 0.02, dur: 0.35, gain: 0.1, attack: 0.18, filter: { type: 'bandpass', freq: 600, to: 5000, q: 1.5 }, reverb: 0.3 });
      // Monedas (Si5 → Mi6, onda cuadrada filtrada) mientras salen disparadas
      this.tone({ type: 'square', freq: 987.77, at: 0.12, dur: 0.08, gain: 0.05, attack: 0.002, filter: { type: 'lowpass', freq: 3500 } });
      this.tone({ type: 'square', freq: 1318.51, at: 0.19, dur: 0.22, gain: 0.05, attack: 0.002, filter: { type: 'lowpass', freq: 3500 }, reverb: 0.2 });
      // Arpegio mágico: Do5 Sol5 Do6 Mi6 Sol6 Do7
      [523.25, 783.99, 1046.5, 1318.51, 1567.98, 2093].forEach((freq, i, arr) =>
        this.tone({
          type: i === arr.length - 1 ? 'triangle' : 'sine',
          freq,
          at: 0.1 + i * 0.05,
          dur: i === arr.length - 1 ? 0.7 : 0.3,
          gain: 0.12,
          attack: 0.01,
          reverb: 0.45,
        }),
      );
    });
  }

  /* ---------- Chat flotante del coach ---------- */

  /** Abrir el chat: dos burbujas ascendentes */
  public chatOpen() {
    this.play(() => {
      this.tone({ freq: 523.25, to: 659.25, dur: 0.09, gain: 0.1, attack: 0.008 });
      this.tone({ freq: 783.99, to: 1046.5, at: 0.07, dur: 0.12, gain: 0.09, attack: 0.008, reverb: 0.12 });
    });
  }

  /** Mensaje enviado: «fiu» corto hacia arriba */
  public messageOut() {
    this.play(() => this.tone({ freq: 480, to: 1150, dur: 0.09, gain: 0.08, attack: 0.006 }));
  }

  /** Respuesta del coach recibida: campanita doble suave */
  public messageIn() {
    this.play(() => {
      this.tone({ freq: 1046.5, dur: 0.18, gain: 0.08, attack: 0.008, reverb: 0.15 });
      this.tone({ freq: 783.99, at: 0.09, dur: 0.3, gain: 0.08, attack: 0.008, reverb: 0.2 });
    });
  }
}

export const playSound = new SoundEngine();
