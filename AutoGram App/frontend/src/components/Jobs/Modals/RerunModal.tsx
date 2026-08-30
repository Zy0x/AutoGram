import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Play } from 'lucide-react';

interface RerunModalProps {
  jobName: string;
  successCount: number;
  onClose: () => void;
  onConfirm: (mode: 'RESUME' | 'OVERWRITE' | 'SMART_SYNC') => void;
}

export function RerunModal({ jobName, successCount, onClose, onConfirm }: RerunModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'RESUME' | 'OVERWRITE' | 'SMART_SYNC'>('RESUME');
  
  // Overwrite safety checks
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [check3, setCheck3] = useState(false);

  const isOverwriteValid = mode !== 'OVERWRITE' || (check1 && check2 && check3);

  const node = (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-panel glass-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-main)', minWidth: 0 }}>
            <Play size={20} className="text-primary" style={{ flexShrink: 0 }} />
            {t('ui.generated.re_run_job_cf0f2a4')}
          </h3>
          <button type="button" onClick={onClose} className="btn-tertiary" aria-label={t('drive.preview_close_btn')}>
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body" style={{ padding: 'clamp(1rem, 3vw, 1.5rem)', color: 'var(--text-main)', fontSize: '0.95rem', lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            {t('ui.generated.job_30c8cb8')} <strong>{jobName}</strong> {t('ui.generated.sebelumnya_3162a26')} <strong style={{ color: 'var(--success)' }}>{successCount.toLocaleString()} {t('ui.generated.pesan_sukses_6a963bd')}</strong>
          </p>
          <p style={{ fontWeight: 600, marginBottom: '12px' }}>{t('ui.generated.pilih_mode_untuk_eksekusi_ulang_ebb3f1d')}</p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* RESUME */}
            <label style={{ 
                display: 'flex', gap: '12px', padding: '16px', 
                background: mode === 'RESUME' ? 'rgba(99, 102, 246, 0.1)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${mode === 'RESUME' ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: '8px', cursor: 'pointer'
            }}>
              <input type="radio" name="rerun-mode" checked={mode === 'RESUME'} onChange={() => setMode('RESUME')} style={{ marginTop: '4px' }} />
              <div>
                <strong style={{ display: 'block', color: 'var(--text-main)', marginBottom: '4px' }}>{t('ui.generated.resume_lanjutkan_dari_checkpoint_2b0b5af')}</strong>
                <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <li>{t('ui.generated.lewati_pesan_sudah_sukses_6042f4b')}</li>
                  <li>{t('jobs.rerun_incomplete')}</li>
                  <li>{t('ui.generated.cepat_aman_default_d8993d7')}</li>
                </ul>
              </div>
            </label>

            {/* OVERWRITE */}
            <label style={{ 
                display: 'flex', gap: '12px', padding: '16px', 
                background: mode === 'OVERWRITE' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${mode === 'OVERWRITE' ? 'var(--danger)' : 'var(--border)'}`,
                borderRadius: '8px', cursor: 'pointer'
            }}>
              <input type="radio" name="rerun-mode" checked={mode === 'OVERWRITE'} onChange={() => setMode('OVERWRITE')} style={{ marginTop: '4px' }} />
              <div>
                <strong style={{ display: 'block', color: 'var(--danger)', marginBottom: '4px' }}>{t('ui.generated.overwrite_kirim_ulang_semua_pesan_cdb9235')}</strong>
                <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <li>{t('ui.generated.force_re_process_semua_pesan_7a0b083')}</li>
                  <li>{t('ui.generated.bisa_duplikat_jika_lama_tidak_dihapus_502b6e3')}</li>
                  <li>{t('ui.generated.gunakan_jika_destination_dibersihkan_29bd85c')}</li>
                </ul>
              </div>
            </label>

            {mode === 'OVERWRITE' && (
                <div style={{ marginLeft: 0, padding: '16px', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    <p style={{ margin: '0 0 12px 0', color: 'var(--danger)', fontWeight: 600, fontSize: '0.85rem' }}>{t('ui.generated.peringatan_ekstrem_centang_semua_untuk_melanjutk_4ed01a7')}</p>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={check1} onChange={e => setCheck1(e.target.checked)} />
                        {t('ui.generated.saya_mengerti_risiko_limitasi_api_karena_pengiri_c7abb15')}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={check2} onChange={e => setCheck2(e.target.checked)} />
                        {t('ui.generated.saya_sudah_menghapus_pesan_lama_di_destination_4cd3dd4')}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={check3} onChange={e => setCheck3(e.target.checked)} />
                        {t('ui.generated.saya_tidak_akan_menggunakan_akun_ini_selama_pros_185e143')}
                    </label>
                </div>
            )}

            {/* SMART SYNC */}
            <label style={{ 
                display: 'flex', gap: '12px', padding: '16px', 
                background: mode === 'SMART_SYNC' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${mode === 'SMART_SYNC' ? 'var(--warning)' : 'var(--border)'}`,
                borderRadius: '8px', cursor: 'pointer'
            }}>
              <input type="radio" name="rerun-mode" checked={mode === 'SMART_SYNC'} onChange={() => setMode('SMART_SYNC')} style={{ marginTop: '4px' }} />
              <div>
                <strong style={{ display: 'block', color: 'var(--warning)', marginBottom: '4px' }}>{t('ui.generated.smart_sync_sinkronisasi_dengan_validasi_4da67b6')}</strong>
                <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <li>{t('ui.generated.adaptive_sampling_untuk_mendeteksi_pesan_yang_di_d89f7a5')}</li>
                  <li>{t('ui.generated.balance_antara_kecepatan_dan_keakuratan_8f49371')}</li>
                  <li>{t('ui.generated.gunakan_jika_curiga_ada_yang_terhapus_di_tujuan_8287966')}</li>
                </ul>
              </div>
            </label>
          </div>
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
          <button type="button" className="btn btn-primary" disabled={!isOverwriteValid} onClick={() => onConfirm(mode)}>
            <Play size={16} />
            {t('ui.generated.lanjutkan_re_run_38cfc49')}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
