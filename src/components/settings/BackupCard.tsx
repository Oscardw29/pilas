import React, { useState } from 'react';
import { Database, Download, Upload } from 'lucide-react';
import { useStore, selectData } from '@/store/useStore';
import type { AppData } from '@/types';
import { validateBackup } from '@/lib/validateBackup';
import { todayKey } from '@/lib/dates';
import { playSound } from '@/lib/sound';
import { useToast } from '@/components/ui/ToastContext';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { decryptBackup, encryptBackup, isEncryptedBackup, type EncryptedBackup } from '@/crypto/backup';

/**
 * Exportar / restaurar respaldos. El respaldo nunca incluye claves de API y la restauración
 * se valida y se confirma antes de reemplazar los datos.
 */
export const BackupCard: React.FC<{ onDataReplaced: () => void }> = ({ onDataReplaced }) => {
  const importData = useStore((s) => s.importData);
  const { showToast } = useToast();
  const [pendingImport, setPendingImport] = useState<{ data: AppData; summary: string } | null>(null);
  const [encrypt, setEncrypt] = useState(true);
  const [exportPassword, setExportPassword] = useState('');
  const [busy, setBusy] = useState(false);
  /** Respaldo cifrado elegido para restaurar: falta la contraseña */
  const [locked, setLocked] = useState<EncryptedBackup | null>(null);
  const [importPassword, setImportPassword] = useState('');

  const handleExport = async () => {
    if (encrypt && exportPassword.length < 8) {
      showToast('Escribe una contraseña de al menos 8 caracteres para cifrar el respaldo', 'warning');
      return;
    }
    // El respaldo nunca incluye claves de API (viven en un almacén separado) ni el temporizador en curso
    const data = { ...selectData(useStore.getState()), activeTimer: null };
    setBusy(true);
    let dataStr: string;
    try {
      dataStr = encrypt ? JSON.stringify(await encryptBackup(JSON.stringify(data), exportPassword)) : JSON.stringify(data, null, 2);
    } finally {
      setBusy(false);
    }
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pilas_backup_${todayKey()}${encrypt ? '_cifrado' : ''}.json`;
    a.click();
    // Liberar después: revocar en el mismo tick puede cancelar la descarga en Safari/Firefox
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    playSound.pop();
    setExportPassword('');
    showToast(encrypt ? 'Respaldo cifrado descargado (sin claves de API)' : 'Copia de seguridad descargada (sin claves de API)', 'success');
  };

  const accept = (parsed: unknown) => {
    const result = validateBackup(parsed);
    if (!result.ok) {
      showToast(`Respaldo no válido: ${result.error}`, 'error');
      return;
    }
    // Confirmar antes de reemplazar todos los datos actuales
    setPendingImport({ data: result.data, summary: result.summary });
  };

  const unlockImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locked) return;
    setBusy(true);
    try {
      const parsed = await decryptBackup(locked, importPassword);
      setLocked(null);
      setImportPassword('');
      accept(parsed);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo abrir el respaldo', 'error');
    } finally {
      setBusy(false);
    }
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
      if (isEncryptedBackup(parsed)) {
        setLocked(parsed);
        return;
      }
      accept(parsed);
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
            Tus datos ya se sincronizan con tu cuenta. Además puedes descargar una copia en un archivo (opcionalmente cifrada con contraseña) y restaurarla cuando quieras.
          </p>

          <div className="form" style={{ marginBottom: 14 }}>
            <label className="checkbox">
              <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
              Cifrar el respaldo con contraseña (recomendado: incluye tus notas y chats)
            </label>
            {encrypt && (
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="Contraseña del respaldo (mín. 8 caracteres)"
                aria-label="Contraseña del respaldo"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
              />
            )}
          </div>

          <div className="grid-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleExport()}
              disabled={busy}
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

        {locked && (
          <form className="card form" onSubmit={(e) => void unlockImport(e)} style={{ marginTop: 12 }}>
            <div className="card-title">Respaldo cifrado</div>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Contraseña del respaldo"
              aria-label="Contraseña del respaldo"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              data-autofocus
            />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" type="submit" disabled={busy || !importPassword}>
                {busy ? 'Abriendo…' : 'Abrir respaldo'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setLocked(null)}>
                Cancelar
              </button>
            </div>
          </form>
        )}

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
