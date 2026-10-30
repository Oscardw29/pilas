import React from 'react';
import { Link } from 'react-router-dom';
import { CloudOff, RefreshCw, UserPlus } from 'lucide-react';
import { socialAvailable } from '@/social/api';
import './social.css';

/** Estados comunes de las páginas de la comunidad: error con reintento, servidor sin capa pública y llamada a crear el perfil */

export const LoadError: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="callout attention lb-error" role="alert">
    <CloudOff aria-hidden="true" />
    <div className="lb-error-body">
      <p>{message}</p>
      <button type="button" className="btn btn-secondary sm" onClick={onRetry}>
        <RefreshCw aria-hidden="true" /> Reintentar
      </button>
    </div>
  </div>
);

export const SocialUnavailable: React.FC<{ what: string }> = ({ what }) => (
  <div className="card">
    <div className="empty">
      <div className="empty-icon">
        <CloudOff aria-hidden="true" />
      </div>
      <h3>{what} todavía no están disponibles</h3>
      <p>
        {socialAvailable()
          ? 'El servidor aún necesita la capa de comunidad (migración 0002). Cuando esté instalada, aparecerán aquí.'
          : 'Esta versión de la app no está conectada a un servidor, así que la parte de comunidad está apagada.'}
      </p>
    </div>
  </div>
);

export const ProfileCta: React.FC<{ text: string }> = ({ text }) => (
  <section className="card social-cta" aria-label="Crea tu perfil público">
    <div className="empty-icon" style={{ marginBottom: 0 }}>
      <UserPlus aria-hidden="true" />
    </div>
    <div>
      <h3 className="card-title">Crea tu perfil público</h3>
      <p className="card-sub">{text}</p>
    </div>
    <Link to="/perfil" className="btn btn-primary sm">
      Crear mi perfil
    </Link>
  </section>
);
