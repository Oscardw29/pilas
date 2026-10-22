import React from 'react';
import { CloudCheck, CloudOff, CloudAlert, RefreshCw, CloudUpload } from 'lucide-react';
import { useSession } from '@/store/useSession';
import { syncNow } from '@/account/runtime';

/** Estado de la sincronización; al pulsarlo se sincroniza ya */
export const SyncPill: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const sync = useSession((s) => s.sync);
  const error = useSession((s) => s.syncError);
  const map = {
    idle: { icon: <CloudCheck aria-hidden />, label: 'Sincronizado', cls: '' },
    pending: { icon: <CloudUpload aria-hidden />, label: 'Cambios por subir', cls: '' },
    syncing: { icon: <RefreshCw aria-hidden />, label: 'Sincronizando…', cls: 'is-syncing' },
    offline: { icon: <CloudOff aria-hidden />, label: 'Sin conexión', cls: 'is-offline' },
    error: { icon: <CloudAlert aria-hidden />, label: 'Error al sincronizar', cls: 'is-error' },
  }[sync];
  return (
    <button
      type="button"
      className={`sync-pill ${map.cls}`}
      onClick={() => void syncNow()}
      title={error ? `${map.label}: ${error}` : `${map.label} · pulsa para sincronizar`}
      aria-label={map.label}
      data-no-sound="true"
    >
      {map.icon}
      {!compact && <span>{map.label}</span>}
    </button>
  );
};
