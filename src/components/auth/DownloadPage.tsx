import React, { useMemo } from 'react';
import { Apple, Download, Monitor, Smartphone, ShieldAlert } from 'lucide-react';
import { BrandMark } from '@/components/ui/BrandMark';
import './auth.css';

/**
 * Página pública de descarga (/descargar): no requiere cuenta.
 * Los instaladores se publican en GitHub Releases (ver .github/workflows/release.yml y docs/guia-instaladores.md, 7.3).
 * `VITE_DOWNLOADS_URL` apunta a la última versión (`…/releases/latest`). Cada versión lleva los instaladores también con un
 * nombre fijo (ASSETS), así los botones descargan el archivo directamente desde `…/releases/latest/download/<nombre>`,
 * sin pasar por la página de GitHub.
 */

const DOWNLOADS_URL = (import.meta.env.VITE_DOWNLOADS_URL as string | undefined)?.replace(/\/+$/, '');

/** Nombres fijos de los instaladores en cada versión (deben coincidir con los del workflow y la guía) */
export const ASSETS = {
  android: 'Pilas-Android.apk',
  windows: 'Pilas-Windows.exe',
  appimage: 'Pilas-Linux.AppImage',
  deb: 'Pilas-Linux.deb',
} as const;

/** Enlace de descarga directa; solo si VITE_DOWNLOADS_URL es la «última versión» de GitHub Releases */
const directUrl = (file: string) => (DOWNLOADS_URL && /\/releases\/latest$/.test(DOWNLOADS_URL) ? `${DOWNLOADS_URL}/download/${file}` : null);

type Os = 'android' | 'windows' | 'linux' | 'ios' | 'mac' | 'other';

function detectOs(): Os {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/macintosh|mac os x/i.test(ua)) return 'mac';
  if (/windows/i.test(ua)) return 'windows';
  if (/linux/i.test(ua)) return 'linux';
  return 'other';
}

export const DownloadPage: React.FC = () => {
  const os = useMemo(detectOs, []);
  /** Botón que descarga el archivo; si la dirección no es de GitHub Releases, abre la página de descargas */
  const link = (label: string, file: string, primary = true) => {
    const direct = directUrl(file);
    if (!DOWNLOADS_URL) return <p className="small muted">Los instaladores aún no están publicados.</p>;
    return direct ? (
      <a className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} block`} href={direct} download={file}>
        <Download aria-hidden /> {label}
      </a>
    ) : (
      <a className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} block`} href={DOWNLOADS_URL} target="_blank" rel="noreferrer">
        <Download aria-hidden /> {label}
      </a>
    );
  };

  const sections: { id: Os[]; icon: React.ReactNode; title: string; body: React.ReactNode }[] = [
    {
      id: ['android'],
      icon: <Smartphone aria-hidden />,
      title: 'Android',
      body: (
        <>
          {link('Descargar APK', ASSETS.android)}
          <p className="small muted">
            Al abrir el archivo, Android pedirá permitir instalar apps de «orígenes desconocidos» para tu navegador. Es normal: la
            app no está en Google Play.
          </p>
        </>
      ),
    },
    {
      id: ['windows'],
      icon: <Monitor aria-hidden />,
      title: 'Windows',
      body: (
        <>
          {link('Descargar instalador (.exe)', ASSETS.windows)}
          <p className="small muted">
            Si aparece «Windows protegió tu PC», pulsa <strong>Más información → Ejecutar de todas formas</strong>. Sale porque el
            instalador no tiene un certificado de pago.
          </p>
        </>
      ),
    },
    {
      id: ['linux'],
      icon: <Monitor aria-hidden />,
      title: 'Linux',
      body: (
        <>
          {link('Descargar .AppImage', ASSETS.appimage)}
          {link('Descargar .deb (Debian/Ubuntu)', ASSETS.deb, false)}
          <p className="small muted">AppImage: dale permiso de ejecución (chmod +x) y ábrelo. Debian/Ubuntu: instala el .deb.</p>
        </>
      ),
    },
    {
      id: ['ios'],
      icon: <Apple aria-hidden />,
      title: 'iPhone y iPad',
      body: (
        <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.6, color: 'var(--text-2)' }}>
          <li>Abre esta web en <strong>Safari</strong>.</li>
          <li>Pulsa el botón Compartir.</li>
          <li>Elige <strong>«Añadir a pantalla de inicio»</strong>.</li>
        </ol>
      ),
    },
    {
      id: ['mac'],
      icon: <Apple aria-hidden />,
      title: 'Mac',
      body: (
        <p className="small" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
          En Safari: menú <strong>Archivo → Añadir al Dock</strong>. En Chrome o Edge: el botón «Instalar» de la barra de direcciones.
        </p>
      ),
    },
  ];

  // Primero el sistema de quien visita
  const ordered = [...sections].sort((a, b) => Number(b.id.includes(os)) - Number(a.id.includes(os)));

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="auth-brand">
          <BrandMark size={44} />
          <div>
            <h1>Descarga ¡Pilas!</h1>
            <p>Gratis en Android, Windows y Linux. En iPhone, iPad y Mac, como app web.</p>
          </div>
        </div>

        {ordered.map((s, i) => (
          <section key={s.title} className={`card${i === 0 ? ' highlight' : ''}`}>
            <div className="card-head">
              <div className="row">
                {s.icon}
                <div className="card-title">{s.title}</div>
              </div>
              {i === 0 && os !== 'other' && <span className="badge accent">Tu dispositivo</span>}
            </div>
            <div className="form">{s.body}</div>
          </section>
        ))}

        <div className="callout neutral">
          <ShieldAlert aria-hidden />
          <div className="detail">
            Necesitas una cuenta (gratis) para sincronizar tus datos entre dispositivos. Tus claves API nunca salen de tu dispositivo.
          </div>
        </div>
        <a className="btn btn-secondary block" href="/">
          Abrir la app web
        </a>
        {DOWNLOADS_URL && (
          <a className="small muted" href={DOWNLOADS_URL} target="_blank" rel="noreferrer" style={{ textAlign: 'center' }}>
            Ver todas las versiones y novedades
          </a>
        )}
      </div>
    </div>
  );
};
