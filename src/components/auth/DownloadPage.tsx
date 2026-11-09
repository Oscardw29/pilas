import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Apple, CalendarDays, Check, Download, Droplet, Flame, Gem, Gift, Globe, Medal, MessageCircle, Monitor, Smartphone,
  Sparkles, Star, Timer, Trophy, Volume2,
} from 'lucide-react';
import { BrandMark } from '@/components/ui/BrandMark';
import { CoachAvatar } from '@/components/coach/CoachAvatar';
import '@fontsource/inter/latin-900.css';
import { fetchRatingSummary, ratingsAvailable, type RatingSummary } from '@/lib/appRating';
import { RatingPanel, RatingSeal, type RatingState } from './DownloadRating';
import './download.css';

/**
 * PÁGINA PÚBLICA DE DESCARGA (/descargar), sin cuenta.
 * Un cartel de colores planos: «¡Ponte las pilas!» partido entre dos campos de color con el sello de la calificación,
 * el selector de dispositivo en grande (detecta el de quien visita y el botón descarga directamente su instalador),
 * lo que hace la app, capturas reales (computador y celular), las dudas como un chat con Pilo y las estrellas para
 * calificar (DownloadRating.tsx).
 *
 * Los instaladores se publican en GitHub Releases (ver .github/workflows/release.yml y docs/guia-instaladores.md, 7.3).
 * `VITE_DOWNLOADS_URL` apunta a la última versión (`…/releases/latest`). Cada versión lleva los instaladores con un
 * nombre fijo (ASSETS), así los botones descargan el archivo directamente desde `…/releases/latest/download/<nombre>`.
 * Aquí no sale la animación de apertura (public/theme-init.js marca la página y lib/bootSplash.ts la quita).
 */

const DOWNLOADS_URL = (import.meta.env.VITE_DOWNLOADS_URL as string | undefined)?.replace(/\/+$/, '');

/** Nombres fijos de los instaladores en cada versión (deben coincidir con los del workflow y la guía) */
export const ASSETS = {
  android: 'Pilas-Android.apk',
  windows: 'Pilas-Windows.exe',
  appimage: 'Pilas-Linux.AppImage',
  deb: 'Pilas-Linux.deb',
} as const;

/** Descarga directa; solo si VITE_DOWNLOADS_URL es la «última versión» de GitHub Releases. Si no, la página de descargas */
const fileUrl = (file: string) =>
  DOWNLOADS_URL && /\/releases\/latest$/.test(DOWNLOADS_URL) ? `${DOWNLOADS_URL}/download/${file}` : DOWNLOADS_URL ?? null;

type Os = 'android' | 'windows' | 'linux' | 'ios' | 'mac';

function detectOs(): Os {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/macintosh|mac os x/i.test(ua)) return 'mac';
  if (/linux/i.test(ua)) return 'linux';
  return 'windows';
}

interface Platform {
  id: Os;
  label: string;
  icon: React.ReactNode;
  /** Instalable (Android, Windows, Linux) o app web (iPhone, iPad, Mac) */
  kind: 'install' | 'web';
  files: { label: string; file: string }[];
  steps: React.ReactNode[];
}

const PLATFORMS: Platform[] = [
  {
    id: 'android',
    label: 'Android',
    icon: <Smartphone aria-hidden />,
    kind: 'install',
    files: [{ label: 'Descargar para Android', file: ASSETS.android }],
    steps: [
      <>Abre <strong>Pilas-Android.apk</strong> desde las descargas del celular.</>,
      <>Si Android te pide permiso, dale: la app todavía no está en Google Play.</>,
      <>Toca <strong>Instalar</strong> y listo, abre ¡Pilas!.</>,
    ],
  },
  {
    id: 'windows',
    label: 'Windows',
    icon: <Monitor aria-hidden />,
    kind: 'install',
    files: [{ label: 'Descargar para Windows', file: ASSETS.windows }],
    steps: [
      <>Abre <strong>Pilas-Windows.exe</strong>.</>,
      <>Si sale «Windows protegió tu PC», dale a <strong>Más información → Ejecutar de todas formas</strong>.</>,
      <>Sigue el instalador. No te pide permisos de administrador.</>,
    ],
  },
  {
    id: 'linux',
    label: 'Linux',
    icon: <Monitor aria-hidden />,
    kind: 'install',
    files: [
      { label: 'Descargar AppImage', file: ASSETS.appimage },
      { label: 'Descargar .deb', file: ASSETS.deb },
    ],
    steps: [
      <><strong>AppImage</strong>: dale permiso de ejecución (<em>chmod +x</em>) y ábrelo.</>,
      <><strong>Debian o Ubuntu</strong>: instala el .deb con tu gestor de paquetes.</>,
    ],
  },
  {
    id: 'ios',
    label: 'iPhone y iPad',
    icon: <Apple aria-hidden />,
    kind: 'web',
    files: [],
    steps: [
      <>Abre la app web en <strong>Safari</strong>.</>,
      <>Toca el botón <strong>Compartir</strong>.</>,
      <>Elige <strong>Añadir a pantalla de inicio</strong> y te queda como una app más.</>,
    ],
  },
  {
    id: 'mac',
    label: 'Mac',
    icon: <Apple aria-hidden />,
    kind: 'web',
    files: [],
    steps: [
      <>Abre la app web en Safari, Chrome o Edge.</>,
      <>Safari: <strong>Archivo → Añadir al Dock</strong>. Chrome o Edge: el botón <strong>Instalar</strong> de la barra de direcciones.</>,
    ],
  },
];

interface Feature {
  word: string;
  fact: string;
  detail: string;
  chips: { icon: React.ReactNode; label: string }[];
}

const FEATURES: Feature[] = [
  {
    word: 'Hábitos',
    fact: 'Mídelos como te funcione',
    detail: 'Por tiempo, por cantidad o de sí o no: leer 20 minutos, tomarte 8 vasos de agua o tender la cama. Tú decides qué días tocan.',
    chips: [
      { icon: <Timer aria-hidden />, label: '20 min' },
      { icon: <Droplet aria-hidden />, label: '8 vasos' },
      { icon: <Check aria-hidden />, label: 'Sí o no' },
    ],
  },
  {
    word: 'Rachas',
    fact: 'Una llama que crece contigo',
    detail: 'Cada día que cumples, la racha suma y la llama se pone más grande. ¿Fallaste un día? Tranqui, arrancas otra vez.',
    chips: [
      { icon: <Flame aria-hidden />, label: 'Día a día' },
      { icon: <CalendarDays aria-hidden />, label: 'Tu semana' },
    ],
  },
  {
    word: 'Puntos',
    fact: 'Date tus gusticos',
    detail: 'Cada hábito cumplido te da puntos. Cámbialos por los premios que tú mismo pones: una película, un postre, una tarde libre.',
    chips: [
      { icon: <Star aria-hidden />, label: 'Puntos' },
      { icon: <Gift aria-hidden />, label: 'Tus premios' },
    ],
  },
  {
    word: 'Pilo',
    fact: 'Un coach que sí te habla',
    detail: 'Te da consejos, te responde con ideas rápidas y te anima con su propia voz. Si prefieres, te acompaña Pila.',
    chips: [
      { icon: <MessageCircle aria-hidden />, label: 'Chat' },
      { icon: <Volume2 aria-hidden />, label: 'Con voz' },
    ],
  },
  {
    word: 'Ligas',
    fact: 'Compite cada semana',
    detail: 'Suma puntos con tus hábitos y mídete con otras personas. Cada semana puedes subir de Bronce hasta Diamante.',
    chips: [
      { icon: <Trophy aria-hidden />, label: 'Bronce' },
      { icon: <Gem aria-hidden />, label: 'Diamante' },
    ],
  },
  {
    word: 'Logros',
    fact: 'Medallas para coleccionar',
    detail: 'Desbloquea medallas por tus rachas, tus semanas perfectas y todo lo que vas logrando. Cada una cuenta tu historia.',
    chips: [
      { icon: <Medal aria-hidden />, label: 'Medallas' },
      { icon: <Sparkles aria-hidden />, label: 'Semana perfecta' },
    ],
  },
];

const DESKTOP_SHOT = {
  src: '/capturas/computador.webp',
  alt: 'Pantalla de inicio de ¡Pilas! en el computador, con el menú a un lado y el progreso del día',
  width: 1440,
  height: 900,
};

const SHOTS: { src: string; alt: string; caption: string }[] = [
  { src: '/capturas/inicio.webp', alt: 'Pantalla de inicio de ¡Pilas! con el progreso del día y los puntos', caption: 'Tu día de un vistazo' },
  { src: '/capturas/habitos.webp', alt: 'Semana de hábitos con los días cumplidos marcados', caption: 'Tu semana, día a día' },
  { src: '/capturas/coach.webp', alt: 'Pilo, el coach, listo para responder con ideas rápidas', caption: 'Pilo te responde' },
  { src: '/capturas/recompensas.webp', alt: 'Tienda de recompensas con los puntos disponibles y el nivel', caption: 'Tus puntos se canjean' },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: '¿Cuánto cuesta?', a: 'Nada. ¡Pilas! es gratis en todos los dispositivos: sin anuncios y sin suscripciones.' },
  {
    q: '¿Por qué Windows dice «Windows protegió tu PC»?',
    a: (
      <>
        Porque el instalador no tiene un certificado de pago, nada más. Dale a <strong>Más información</strong> y luego a{' '}
        <strong>Ejecutar de todas formas</strong>.
      </>
    ),
  },
  {
    q: '¿Por qué Android me pide permiso para instalarla?',
    a: 'Porque todavía no está en Google Play. Dale permiso a tu navegador o a tu gestor de archivos, toca Instalar y listo.',
  },
  {
    q: '¿Y en iPhone, iPad o Mac?',
    a: (
      <>
        Usas la app web. En Safari: <strong>Compartir → Añadir a pantalla de inicio</strong>. En Mac:{' '}
        <strong>Archivo → Añadir al Dock</strong>. Queda como una app más.
      </>
    ),
  },
  {
    q: '¿Necesito una cuenta?',
    a: 'Sí, una gratis con tu correo. Así tus hábitos, rachas y puntos te siguen a todos tus dispositivos.',
  },
];

/** Entrada de cada sección al aparecer (una vez). Sin JS o con «reducir movimiento», todo se ve desde el principio */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    root.classList.add('dl-anim');
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }),
      { rootMargin: '0px 0px -12% 0px' },
    );
    root.querySelectorAll('.dl-reveal').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return ref;
}

/** Media y número de votos: se piden una vez y se actualizan al votar */
function useRating() {
  const [state, setState] = useState<RatingState>(ratingsAvailable ? { status: 'loading' } : { status: 'error' });
  useEffect(() => {
    if (!ratingsAvailable) return;
    let alive = true;
    fetchRatingSummary()
      .then((summary) => alive && setState({ status: 'ready', summary }))
      .catch(() => alive && setState({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, []);
  const onRated = (summary: RatingSummary) => setState({ status: 'ready', summary });
  return [state, onRated] as const;
}

export const DownloadPage: React.FC = () => {
  const detected = useMemo(detectOs, []);
  const [os, setOs] = useState<Os>(detected);
  const [openFaq, setOpenFaq] = useState<Set<number>>(() => new Set([0]));
  const [rating, onRated] = useRating();
  const rootRef = useReveal();
  const platform = PLATFORMS.find((p) => p.id === os)!;
  const primary = PLATFORMS.find((p) => p.id === detected)!;
  const published = Boolean(DOWNLOADS_URL);

  useEffect(() => {
    document.title = 'Descarga ¡Pilas! · Hábitos, rachas y un coach';
  }, []);

  const toggleFaq = (i: number) =>
    setOpenFaq((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const segRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onSegKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + PLATFORMS.length) % PLATFORMS.length;
    setOs(PLATFORMS[n].id);
    segRefs.current[n]?.focus();
  };

  return (
    <div className="dl" ref={rootRef}>
      {/* 1 · Cartel: dos campos de color, el grito partido por la línea de flotación y el sello de la calificación */}
      <header className="dl-hero">
        <nav className="dl-bar" aria-label="¡Pilas!">
          <a className="dl-brand" href="/" aria-label="¡Pilas!, abrir la app web">
            <BrandMark size={34} />
            <span>
              <span className="dl-bang">¡</span>Pilas<span className="dl-bang">!</span>
            </span>
          </a>
          <a className="dl-btn dl-btn-accent dl-bar-cta" href="#descargar">
            <Download aria-hidden /> Descargar
          </a>
        </nav>

        <h1 className="dl-title">
          <span className="dl-title-copy dl-title-top">
            <span className="dl-title-in">
              <span className="dl-line"><span>¡Ponte</span></span>
              <span className="dl-line"><span>las pilas!</span></span>
            </span>
          </span>
          <span className="dl-title-copy dl-title-bottom" aria-hidden="true">
            <span className="dl-title-in">
              <span className="dl-line"><span>¡Ponte</span></span>
              <span className="dl-line"><span>las pilas!</span></span>
            </span>
          </span>
        </h1>

        <div className="dl-hero-foot">
          <p className="dl-lede">
            ¡Pilas! es la app gratis para cumplir tus hábitos: prende tu racha cada día, gana puntos para darte tus gusticos y deja
            que Pilo, tu coach, te eche una mano.
          </p>
          <div className="dl-hero-ctas">
            <a className="dl-btn dl-btn-ink" href="#descargar">
              {primary.icon} {primary.kind === 'web' ? `Usar en ${primary.label}` : `Descargar para ${primary.label}`}
            </a>
            <a className="dl-btn dl-btn-glass" href="#calificar">
              <Star aria-hidden /> Calificar
            </a>
          </div>
        </div>
        <RatingSeal state={rating} />
        <div className="dl-pilo" aria-hidden="true">
          <CoachAvatar gender="male" crop="bust" size={260} expression="happy" gesture="wave" gestureKey={1} followPointer={false} />
        </div>
      </header>

      {/* 2 · El video de presentación (46 s). Solo en la web: las compilaciones nativas no llevan public/video (vite.config.ts) */}
      <section className="dl-film" aria-labelledby="dl-film-title">
        <div className="dl-wrap">
          <div className="dl-film-head dl-reveal">
            <h2 id="dl-film-title">Míralo en 46 segundos</h2>
            <p>Del «mañana empiezo» a tu racha prendida. Dale play con sonido: Pilo te habla.</p>
          </div>
          <div className="dl-film-frame dl-reveal">
            <video
              src="/video/pilas-presentacion.mp4"
              poster="/video/pilas-presentacion.webp"
              controls
              playsInline
              preload="none"
              width={1920}
              height={1080}
              aria-label="Video de presentación de ¡Pilas!"
            />
          </div>
        </div>
      </section>

      {/* 3 · Lo vivo de la página: el selector de dispositivo en grande */}
      <section id="descargar" className={`dl-get is-${platform.kind}`} aria-labelledby="dl-get-title">
        <div className="dl-wrap">
          <div className="dl-get-head dl-reveal">
            <h2 id="dl-get-title">{platform.kind === 'web' ? 'Úsala en tu navegador' : 'Descárgala en tu dispositivo'}</h2>
            <p>
              {os === detected ? 'Ya te elegimos el tuyo.' : `Elegiste ${platform.label}.`} ¿La quieres en otro? Cámbialo aquí: es la
              misma cuenta en todos.
            </p>
          </div>

          <div className="dl-seg dl-reveal" role="radiogroup" aria-label="Tu dispositivo" data-ui>
            {PLATFORMS.map((p, i) => (
              <button
                key={p.id}
                ref={(el) => {
                  segRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={os === p.id}
                tabIndex={os === p.id ? 0 : -1}
                className={os === p.id ? 'is-on' : ''}
                onClick={() => setOs(p.id)}
                onKeyDown={(e) => onSegKey(e, i)}
              >
                {p.icon}
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          <div className="dl-reveal">
            {/* Al cambiar de dispositivo el bloque se vuelve a montar con su propia entrada (dl-swap) */}
            <div className="dl-get-body dl-swap" key={platform.id}>
              <div className="dl-get-actions">
                {platform.kind === 'web' ? (
                  <a className="dl-btn dl-btn-ink dl-btn-xl" href="/">
                    <Globe aria-hidden /> Abrir la app web
                  </a>
                ) : published ? (
                  platform.files.map((f, i) => (
                    <a
                      key={f.file}
                      className={`dl-btn dl-btn-xl ${i === 0 ? 'dl-btn-ink' : 'dl-btn-line'}`}
                      href={fileUrl(f.file) ?? undefined}
                      download={f.file}
                    >
                      <Download aria-hidden /> {f.label}
                    </a>
                  ))
                ) : (
                  <p className="dl-soon">Los instaladores salen muy pronto. Mientras tanto, usa la app web.</p>
                )}
                {platform.kind === 'install' && published && <span className="dl-file">{platform.files.map((f) => f.file).join(' · ')}</span>}
              </div>
              <ol className="dl-steps">
                {platform.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* 4 · Lo que hace, como un cartel: la palabra enorme a la izquierda; qué hace y ejemplos a la derecha */}
      <section className="dl-what" aria-labelledby="dl-what-title">
        <div className="dl-wrap">
          <h2 id="dl-what-title" className="dl-reveal">
            Lo que hace por ti
          </h2>
          <ul className="dl-poster">
            {FEATURES.map((f) => (
              <li key={f.word} className="dl-reveal">
                <span className="dl-poster-word">{f.word}</span>
                <div className="dl-poster-text">
                  <p className="dl-poster-fact">{f.fact}</p>
                  <p className="dl-poster-detail">{f.detail}</p>
                  <ul className="dl-chips" aria-label={`Ejemplos de ${f.word}`}>
                    {f.chips.map((c) => (
                      <li key={c.label}>
                        {c.icon}
                        {c.label}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 5 · Capturas reales: el computador en el centro y los celulares alrededor */}
      <section className="dl-look" aria-labelledby="dl-look-title">
        <div className="dl-wrap">
          <div className="dl-look-head dl-reveal">
            <h2 id="dl-look-title">Así se ve por dentro</h2>
            <p>
              Échale un ojo con datos de ejemplo. En el computador es la misma app que en el celular, solo que con más espacio para
              verlo todo de una.
            </p>
          </div>
        </div>
        <div className="dl-stage">
          <figure className="dl-laptop dl-reveal">
            <div className="dl-laptop-screen">
              <img
                src={DESKTOP_SHOT.src}
                alt={DESKTOP_SHOT.alt}
                width={DESKTOP_SHOT.width}
                height={DESKTOP_SHOT.height}
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="dl-laptop-base" aria-hidden="true" />
            <figcaption>En el computador, con todo el espacio</figcaption>
          </figure>
          <ul className="dl-shots">
            {SHOTS.map((s) => (
              <li key={s.src} className="dl-reveal">
                <figure>
                  <img src={s.src} alt={s.alt} width={390} height={844} loading="lazy" decoding="async" />
                  <figcaption>{s.caption}</figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 6 · Dudas: un chat con Pilo. Cada pregunta se abre y se cierra con suavidad */}
      <section className="dl-faq" aria-labelledby="dl-faq-title">
        <div className="dl-wrap">
          <div className="dl-faq-intro dl-reveal">
            <h2 id="dl-faq-title">Antes de instalar</h2>
            <p>¿Te quedó alguna duda? Pregúntale a Pilo: toca una pregunta y él te cuenta.</p>
            <div className="dl-faq-pilo" aria-hidden="true">
              <CoachAvatar gender="male" crop="bust" size={220} expression="happy" followPointer />
            </div>
          </div>
          <div className="dl-chat dl-reveal">
            <div className="dl-chat-head" aria-hidden="true">
              <span className="dl-chat-face">
                <CoachAvatar gender="male" crop="head" size={44} expression="happy" followPointer={false} lively={false} />
              </span>
              <span className="dl-chat-who">
                <strong>Pilo</strong>
                <span className="dl-chat-status">en línea</span>
              </span>
            </div>
            <ul className="dl-chat-list">
              {FAQ.map((f, i) => {
                const open = openFaq.has(i);
                return (
                  <li key={i} className={`dl-chat-item${open ? ' is-open' : ''}`}>
                    <h3>
                      <button type="button" className="dl-bubble-q" aria-expanded={open} aria-controls={`dl-faq-${i}`} onClick={() => toggleFaq(i)}>
                        <span>{f.q}</span>
                        <span className="dl-bubble-sign" aria-hidden="true" />
                      </button>
                    </h3>
                    <div id={`dl-faq-${i}`} className="dl-chat-a" role="region" aria-label={f.q} inert={!open}>
                      <div className="dl-chat-a-in">
                        <p className="dl-bubble-a">
                          <span className="dl-typing" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                          <span className="dl-bubble-text">{f.a}</span>
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      {/* 7 · Calificación: solo estrellas y la media */}
      <section id="calificar" className="dl-rate" aria-labelledby="dl-rate-title">
        <div className="dl-wrap">
          <div className="dl-rate-box dl-reveal">
            <div className="dl-rate-head">
              <h2 id="dl-rate-title">¿Qué tal te parece?</h2>
              <p>Ponle tu nota a ¡Pilas!. Es un voto por equipo y, si cambias de opinión, lo cambias cuando quieras.</p>
            </div>
            <RatingPanel state={rating} onRated={onRated} />
          </div>
        </div>
      </section>

      {/* 8 · Cierre: el nombre a todo lo ancho */}
      <footer className="dl-foot">
        <div className="dl-wrap">
          <p className="dl-foot-name" aria-hidden="true">
            <span className="dl-bang">¡</span>Pilas<span className="dl-bang">!</span>
          </p>
          <div className="dl-foot-row">
            <nav className="dl-foot-links" aria-label="Más de ¡Pilas!">
              <a href="#descargar">Descargar</a>
              <a href="#calificar">Calificar</a>
              <a href="/">Abrir la app web</a>
              {DOWNLOADS_URL && (
                <a href={DOWNLOADS_URL} target="_blank" rel="noreferrer">
                  Todas las versiones
                </a>
              )}
            </nav>
            <p className="dl-foot-note">Gratis y sin anuncios. Solo necesitas una cuenta con tu correo para tener tus datos en todos lados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
