import React, { useMemo } from 'react';
import { Apple, Download, Monitor, Smartphone, ShieldAlert } from 'lucide-react';
import { BrandMark } from '@/components/ui/BrandMark';
import './auth.css';

/**
 * Página pública de descarga (/descargar): no requiere cuenta.
 * Los instaladores se publican en GitHub Releases (ver .github/workflows/release.yml);
 * `VITE_DOWNLOADS_URL` apunta a la página de la última versión.
 */

const DOWNLOADS_URL = import.meta.env.VITE_DOWNLOADS_URL as string | undefined;

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
  const link = (label: string) =>
    DOWNLOADS_URL ? (
      <a className="btn btn-primary block" href={DOWNLOADS_URL} target="_blank" rel="noreferrer">
        <Download aria-hidden /> {label}
      </a>
    ) : (
      <p className="small muted">Los instaladores aún no están publicados.</p>
    );

  const sections: { id: Os[]; icon: React.ReactNode; title: string; body: React.ReactNode }[] = [
    {
      id: ['android'],
      icon: <Smartphone aria-hidden />,
      title: 'Android',
      body: (
        <>
          {link('Descargar APK')}
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
          {link('Descargar instalador (.exe)')}
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
          {link('Descargar .AppImage o .deb')}
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
            Necesitas una cuenta (gratis). Tus datos se cifran en tu dispositivo antes de sincronizarse y tus claves API nunca salen
            de él.
          </div>
        </div>
        <a className="btn btn-secondary block" href="/">
          Abrir la app web
        </a>
      </div>
    </div>
  );
};
