import React, { useState } from 'react';
import { Database, Download, Upload } from 'lucide-react';
import { useStore, selectData } from '@/store/useStore';
import type { AppData } from '@/types';
import { validateBackup } from '@/lib/validateBackup';
import { todayKey } from '@/lib/dates';
import { playSound } from '@/lib/sound';
import { useToast } from '@/components/ui/ToastContext';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

/**
 * Exportar / restaurar respaldos. El respaldo nunca incluye claves de API y la restauración
 * se valida y se confirma antes de reemplazar los datos.
 */
export const BackupCard: React.FC<{ onDataReplaced: () => void }> = ({ onDataReplaced }) => {
  const importData = useStore((s) => s.importData);
  const { showToast } = useToast();
  const [pendingImport, setPendingImport] = useState<{ data: AppData; summary: string } | null>(null);

  const handleExport = () => {
    // El respaldo nunca incluye claves de API: viven en un almacén separado
    const data = selectData(useStore.getState());
    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pilas_backup_${todayKey()}.json`;
    a.click();
    // Liberar después: revocar en el mismo tick puede cancelar la descarga en Safari/Firefox
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    playSound.pop();
    showToast('Copia de seguridad descargada (sin claves de API)', 'success');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.target?.result as string);
      } catch {
        showToast('Error al leer el archivo JSON', 'error');
        return;
      }
      const result = validateBackup(parsed);
      if (!result.ok) {
        showToast(`Respaldo no válido: ${result.error}`, 'error');
        return;
      }
      // Confirmar antes de reemplazar todos los datos actuales
      setPendingImport({ data: result.data, summary: result.summary });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    importData(pendingImport.data);
    setPendingImport(null);
    playSound.celebration();
    showToast('Datos restaurados correctamente', 'success');
    onDataReplaced();
  };

  return (
    <>
        {/* Copias de seguridad y persistencia */}
        <div className="card" style={{ borderTop: '3px solid var(--accent)' }}>
          <div className="card-head">
            <div className="row">
              <Database size={18} style={{ color: 'var(--accent-2)' }} />
              <div>
                <div className="card-title">Copia de seguridad y persistencia</div>
                <div className="card-sub">Exporta tu historial completo o restaura copias previas</div>
              </div>
            </div>
          </div>

          <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 14 }}>
            Todos tus hábitos, historiales de temporizador, rachas y puntos están guardados localmente. Puedes descargar una copia de seguridad en JSON o restaurarla en cualquier navegador.
          </p>

          <div className="grid-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleExport}
              style={{ padding: 14 }}
            >
              <Download size={16} style={{ color: 'var(--accent-2)' }} />
              Exportar respaldo (.json)
            </button>

            <label
              className="btn btn-secondary"
              style={{
                padding: 14,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                cursor: 'pointer',
              }}
            >
              <Upload size={16} style={{ color: 'var(--accent-2)' }} />
              Restaurar respaldo (.json)
              <input
                type="file"
                accept=".json"
                onChange={handleImport}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>

        {/* Modal Confirmación Importar respaldo */}
        <ConfirmModal
          isOpen={pendingImport !== null}
          onClose={() => setPendingImport(null)}
          onConfirm={confirmImport}
          title="¿Restaurar este respaldo?"
          message={`Se reemplazarán todos tus datos actuales por los del respaldo (${pendingImport?.summary ?? ''}). Tus claves de API y preferencias de voz/IA se conservan. Esta acción no se puede deshacer.`}
          confirmLabel="Restaurar respaldo"
          confirmVariant="warning"
          zIndex={1300}
        />
    </>
  );
};
