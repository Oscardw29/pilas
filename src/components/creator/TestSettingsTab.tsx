import React from 'react';
import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { AnimationTestCard } from '@/components/settings/AnimationTestCard';
import { ApiKeySecurityCard } from '@/components/settings/ApiKeySecurityCard';

/** Ajustes de prueba de este dispositivo (los que Ajustes solo muestra a la cuenta del creador) */
export const TestSettingsTab: React.FC = () => (
  <div className="stack">
    <div className="card">
      <div className="card-head" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
        <div>
          <h2 className="card-title">Más ajustes de prueba</h2>
          <p className="card-sub">Sonidos, notificaciones del sistema y restablecer datos siguen en Ajustes (solo los ves tú).</p>
        </div>
        <Link to="/ajustes" className="btn btn-secondary sm">
          <Settings /> Ir a Ajustes
        </Link>
      </div>
    </div>
    <AnimationTestCard />
    {/* Las claves viven en useSecrets: aquí no hay copia local que limpiar */}
    <ApiKeySecurityCard onKeysForgotten={() => {}} />
  </div>
);
