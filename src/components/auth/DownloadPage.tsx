import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Apple, Download, Globe, Monitor, Smartphone } from 'lucide-react';
import { BrandMark } from '@/components/ui/BrandMark';
import { CoachAvatar } from '@/components/coach/CoachAvatar';
import '@fontsource/inter/latin-900.css';
import './download.css';

/**
 * PÁGINA PÚBLICA DE DESCARGA (/descargar), sin cuenta.
 * Un cartel de colores planos: «¡Ponte las pilas!» partido entre dos campos de color, el selector de dispositivo en
 * grande (detecta el de quien visita y el botón descarga directamente su instalador), lo que hace la app, capturas
 * reales y las dudas de instalación.
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
      <>Abre el archivo <strong>Pilas-Android.apk</strong> desde las descargas.</>,
      <>Si Android lo pide, permite instalar apps de esa fuente: la app no está en Google Play.</>,
      <>Pulsa <strong>Instalar</strong> y abre ¡Pilas!.</>,
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
      <>Si sale «Windows protegió tu PC», pulsa <strong>Más información → Ejecutar de todas formas</strong>.</>,
      <>Sigue el instalador: no pide permisos de administrador.</>,
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
      <>Pulsa el botón <strong>Compartir</strong>.</>,
      <>Elige <strong>Añadir a pantalla de inicio</strong>: queda como una app más.</>,
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

const FEATURES: [string, string][] = [
  ['Hábitos', 'De tiempo, de cantidad o de sí o no'],
  ['Rachas', 'Una llama que crece cada día que cumples'],
  ['Puntos', 'Canjéalos por los premios que tú elijas'],
  ['Pilo', 'Tu coach, con consejos y voz'],
  ['Ligas', 'Compite con otras personas cada semana'],
  ['Logros', 'Medallas para coleccionar'],
];

const SHOTS: { src: string; alt: string; caption: string }[] = [
  { src: '/descargar/inicio.webp', alt: 'Pantalla de inicio de ¡Pilas! con el progreso del día y los puntos', caption: 'Tu día de un vistazo' },
  { src: '/descargar/habitos.webp', alt: 'Semana de hábitos con los días cumplidos marcados', caption: 'Tu semana, día a día' },
  { src: '/descargar/coach.webp', alt: 'Pilo, el coach, listo para responder con ideas rápidas', caption: 'Pilo te responde' },
  { src: '/descargar/recompensas.webp', alt: 'Tienda de recompensas con los puntos disponibles y el nivel', caption: 'Tus puntos se canjean' },
];

const FAQ: { tab: string; q: string; a: React.ReactNode }[] = [
  { tab: 'Precio', q: '¿Cuesta algo?', a: 'No. ¡Pilas! es gratis en todos los dispositivos, sin anuncios ni suscripciones.' },
  {
    tab: 'Windows',
    q: '¿Por qué Windows dice «Windows protegió tu PC»?',
    a: (
      <>
        Porque el instalador no lleva un certificado de pago. Pulsa <strong>Más información</strong> y después{' '}
        <strong>Ejecutar de todas formas</strong>.
      </>
    ),
  },
  {
    tab: 'Android',
    q: '¿Por qué Android pide permiso para instalarla?',
    a: 'La app no está en Google Play. Permite instalar desde tu navegador o tu gestor de archivos, pulsa Instalar y listo.',
  },
  {
    tab: 'iPhone y Mac',
    q: '¿Y en iPhone, iPad o Mac?',
    a: 'Usa la app web: en Safari, Compartir → Añadir a pantalla de inicio. En Mac, Archivo → Añadir al Dock.',
  },
  {
    tab: 'Cuenta',
    q: '¿Necesito una cuenta?',
    a: 'Sí, una cuenta gratis con tu correo. Así tus hábitos, rachas y puntos se sincronizan entre tus dispositivos.',
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

export const DownloadPage: React.FC = () => {
  const detected = useMemo(detectOs, []);
  const [os, setOs] = useState<Os>(detected);
  const [openFaq, setOpenFaq] = useState(0);
  const rootRef = useReveal();
  const platform = PLATFORMS.find((p) => p.id === os)!;
  const primary = PLATFORMS.find((p) => p.id === detected)!;
  const published = Boolean(DOWNLOADS_URL);

  useEffect(() => {
    document.title = 'Descarga ¡Pilas! · Hábitos, rachas y un coach';
  }, []);

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
      {/* 1 · Cartel: dos campos de color y el grito partido por la línea de flotación */}
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
            ¡Pilas! es la app gratis para cumplir tus hábitos: enciende tu racha cada día, gana puntos para darte gustos y deja que
            Pilo, tu coach, te guíe.
          </p>
          <a className="dl-btn dl-btn-ink" href="#descargar">
            {primary.icon} {primary.kind === 'web' ? `Usar en ${primary.label}` : `Descargar para ${primary.label}`}
          </a>
        </div>
        <div className="dl-pilo" aria-hidden="true">
          <CoachAvatar gender="male" crop="bust" size={260} expression="happy" gesture="wave" gestureKey={1} followPointer={false} />
        </div>
      </header>

      {/* 2 · Lo vivo de la página: el selector de dispositivo en grande */}
      <section id="descargar" className={`dl-get is-${platform.kind}`} aria-labelledby="dl-get-title">
        <div className="dl-wrap">
          <div className="dl-get-head dl-reveal">
            <h2 id="dl-get-title">{platform.kind === 'web' ? 'Úsala en tu navegador' : 'Descárgala en tu dispositivo'}</h2>
            <p>
              {os === detected ? 'Ya elegimos el tuyo.' : `Elegiste ${platform.label}.`} Cambia si la quieres en otro: es la misma
              cuenta en todos.
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
                <p className="dl-soon">Los instaladores se publican muy pronto. Mientras tanto, usa la app web.</p>
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

      {/* 3 · Lo que hace, como un cartel: palabras enormes a la izquierda, el dato a la derecha */}
      <section className="dl-what" aria-labelledby="dl-what-title">
        <div className="dl-wrap">
          <h2 id="dl-what-title" className="dl-reveal">
            Lo que hace por ti
          </h2>
          <ul className="dl-poster">
            {FEATURES.map(([word, fact]) => (
              <li key={word} className="dl-reveal">
                <span className="dl-poster-word">{word}</span>
                <span className="dl-poster-fact">{fact}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 4 · Capturas reales de la app, recortadas e inclinadas */}
      <section className="dl-look" aria-labelledby="dl-look-title">
        <div className="dl-wrap">
          <div className="dl-look-head dl-reveal">
            <h2 id="dl-look-title">Así se ve por dentro</h2>
            <p>Cuatro pantallas de la app con datos de ejemplo. En Windows y en el navegador se ve igual, solo que más ancha.</p>
          </div>
        </div>
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
      </section>

      {/* 5 · Dudas, archivadas como fichas con pestaña */}
      <section className="dl-faq" aria-labelledby="dl-faq-title">
        <div className="dl-wrap">
          <h2 id="dl-faq-title" className="dl-reveal">
            Antes de instalar
          </h2>
          <div className="dl-cards">
            {FAQ.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={f.tab} className={`dl-card c${i % 3}${open ? ' is-open' : ''}`} style={{ '--i': i } as React.CSSProperties}>
                  <h3>
                    <button type="button" aria-expanded={open} aria-controls={`dl-faq-${i}`} onClick={() => setOpenFaq(open ? -1 : i)}>
                      <span className="dl-card-tab">{f.tab}</span>
                      <span className="dl-card-q">{f.q}</span>
                    </button>
                  </h3>
                  <div id={`dl-faq-${i}`} className="dl-card-a" hidden={!open}>
                    <p>{f.a}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6 · Cierre: el nombre a todo lo ancho */}
      <footer className="dl-foot">
        <div className="dl-wrap">
          <p className="dl-foot-name" aria-hidden="true">
            <span className="dl-bang">¡</span>Pilas<span className="dl-bang">!</span>
          </p>
          <div className="dl-foot-row">
            <nav className="dl-foot-links" aria-label="Más de ¡Pilas!">
              <a href="#descargar">Descargar</a>
              <a href="/">Abrir la app web</a>
              {DOWNLOADS_URL && (
                <a href={DOWNLOADS_URL} target="_blank" rel="noreferrer">
                  Todas las versiones
                </a>
              )}
            </nav>
            <p className="dl-foot-note">Gratis, sin anuncios. Necesitas una cuenta con tu correo para sincronizar tus datos.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
