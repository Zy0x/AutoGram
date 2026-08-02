import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export interface MediaStudioOverlaysProps {
  dragActive?: boolean;
  mediaDragActive: boolean;
  breadcrumb?: string;
  error: string | null;
  setError: (err: string | null) => void;
  driveCircuitTripped?: boolean;
  retrySec?: number;
  onResetCircuit?: () => void;
}

export const MediaStudioOverlays: React.FC<MediaStudioOverlaysProps> = ({
  dragActive: _dragActive,
  mediaDragActive,
  breadcrumb: _breadcrumb,
  error,
  setError,
  driveCircuitTripped,
  retrySec,
  onResetCircuit,
}) => {
  return (
    <>
      {driveCircuitTripped && (
        <div className="td-error-banner" style={{ background: 'rgba(239, 68, 68, 0.2)', borderColor: 'var(--danger)' }} role="alert">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
            <AlertTriangle size={16} color="var(--danger)" />
            <span>
              Koneksi Telegram terputus berulang kali. Berhenti sejenak untuk menghindari FloodWait ({retrySec ?? 0}s).
            </span>
          </div>
          {onResetCircuit && (
            <button
              type="button"
              className="td-chip-btn"
              onClick={onResetCircuit}
              style={{ background: 'var(--danger)', color: '#fff', border: 'none' }}
            >
              <RefreshCw size={12} /> Coba Lagi Sekarang
            </button>
          )}
        </div>
      )}

      {error && !driveCircuitTripped && (
        <div className="td-error-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="td-chip-btn" onClick={() => setError(null)}>
            Tutup
          </button>
        </div>
      )}

      {mediaDragActive && (
        <div className="td-internal-dnd-tip" role="status">
          Lepas di <strong>chat atau folder</strong> di sidebar untuk memindahkan
        </div>
      )}
    </>
  );
};
