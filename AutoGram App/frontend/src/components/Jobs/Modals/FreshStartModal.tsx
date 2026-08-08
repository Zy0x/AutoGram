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
            {t('ui.generated.fresh_start_konfirmasi_9f9c996')}
          </h3>
          <button type="button" onClick={onClose} className="btn-tertiary" aria-label={t('speedtest.preview_close_btn')}>
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body" style={{ padding: 'clamp(1rem, 3vw, 1.5rem)', color: 'var(--text-main)', fontSize: '0.95rem', lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            {t('ui.generated.anda_akan_menghapus_a4b189a')} <strong>{t('ui.generated.semua_history_mapping_406dcf7')}</strong> {t('ui.generated.untuk_job_b2fd70e')} <br/>
            <strong style={{ color: 'var(--primary)' }}>{jobName}</strong>
          </p>
          
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)', marginBottom: '20px' }}>
            <strong>{t('ui.generated.setelah_ini_16733f8')}</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: '20px', color: 'var(--danger)' }}>
              <li>{t('jobs.fresh_start_cannot_resume')}</li>
              <li>{t('ui.generated.tidak_bisa_deteksi_duplikasi_dengan_job_lama_055b63f')}</li>
              <li>{t('ui.generated.reply_chain_dari_job_lama_tidak_bisa_direkonstru_6c39d6f')}</li>
            </ul>
          </div>
          
          <strong>{t('ui.generated.gunakan_ini_hanya_jika_e95fe93')}</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: '20px', color: 'var(--text-muted)' }}>
            <li>{t('ui.generated.chat_tujuan_benar_benar_kosong_dihapus_semua_dc0bcbe')}</li>
            <li>{t('ui.generated.anda_ingin_mulai_migrasi_dari_nol_2bde676')}</li>
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
            {t('accounts.cancel')}
          </button>
          <button type="button" className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: 'white' }} onClick={onConfirm}>
            <Trash2 size={16} />
            {t('ui.generated.fresh_start_937b5b3')}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
