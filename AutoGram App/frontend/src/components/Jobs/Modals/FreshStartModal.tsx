import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { AlertTriangle, X, Trash2 } from 'lucide-react';

interface FreshStartModalProps {
  jobName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function FreshStartModal({ jobName, onClose, onConfirm }: FreshStartModalProps) {
  const { t } = useTranslation();
  const node = (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-panel glass-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--danger)', minWidth: 0, flexWrap: 'wrap' }}>
            <AlertTriangle size={20} style={{ flexShrink: 0 }} />
            Fresh Start — Konfirmasi
          </h3>
          <button type="button" onClick={onClose} className="btn-tertiary" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body" style={{ padding: 'clamp(1rem, 3vw, 1.5rem)', color: 'var(--text-main)', fontSize: '0.95rem', lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            Anda akan menghapus <strong>SEMUA history mapping</strong> untuk job: <br/>
            <strong style={{ color: 'var(--primary)' }}>{jobName}</strong>
          </p>
          
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)', marginBottom: '20px' }}>
            <strong>Setelah ini:</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: '20px', color: 'var(--danger)' }}>
              <li>{t('jobs.fresh_start_cannot_resume')}</li>
              <li>Tidak bisa deteksi duplikasi dengan job lama</li>
              <li>Reply chain dari job lama tidak bisa direkonstruksi</li>
            </ul>
          </div>
          
          <strong>Gunakan ini hanya jika:</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: '20px', color: 'var(--text-muted)' }}>
            <li>Chat tujuan benar-benar kosong/dihapus semua</li>
            <li>Anda ingin mulai migrasi dari nol</li>
            <li>{t('jobs.fresh_start_dont_care')}</li>
          </ul>
        </div>
        
        <div className="page-header-actions" style={{
          padding: 'clamp(0.75rem, 2vw, 1rem) clamp(1rem, 3vw, 1.5rem)',
          borderTop: '1px solid var(--border)',
          justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: 'white' }} onClick={onConfirm}>
            <Trash2 size={16} />
            Fresh Start
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
