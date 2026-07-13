import { useState } from 'react';
import { X, Play } from 'lucide-react';

interface RerunModalProps {
  jobName: string;
  successCount: number;
  onClose: () => void;
  onConfirm: (mode: 'RESUME' | 'OVERWRITE' | 'SMART_SYNC') => void;
}

export function RerunModal({ jobName, successCount, onClose, onConfirm }: RerunModalProps) {
  const [mode, setMode] = useState<'RESUME' | 'OVERWRITE' | 'SMART_SYNC'>('RESUME');
  
  // Overwrite safety checks
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [check3, setCheck3] = useState(false);

  const isOverwriteValid = mode !== 'OVERWRITE' || (check1 && check2 && check3);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div className="glass-panel" style={{
        background: 'var(--bg-panel)',
        borderRadius: 'var(--radius-lg)',
        width: '600px',
        maxWidth: '90vw',
        border: '1px solid var(--border)'
      }}>
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-main)' }}>
            <Play size={20} className="text-primary" />
            Re-run Job
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>
        
        <div style={{ padding: '24px', color: 'var(--text-main)', fontSize: '0.95rem', lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            Job <strong>{jobName}</strong> sebelumnya: <strong style={{ color: 'var(--success)' }}>{successCount.toLocaleString()} pesan sukses</strong>
          </p>
          <p style={{ fontWeight: 600, marginBottom: '12px' }}>Pilih mode untuk eksekusi ulang:</p>
          
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
                <strong style={{ display: 'block', color: 'var(--text-main)', marginBottom: '4px' }}>RESUME — Lanjutkan dari checkpoint</strong>
                <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <li>Lewati pesan sudah sukses</li>
                  <li>Proses pesan belum/belum selesai</li>
                  <li>Cepat, aman, default</li>
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
                <strong style={{ display: 'block', color: 'var(--danger)', marginBottom: '4px' }}>OVERWRITE — Kirim ulang SEMUA pesan</strong>
                <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <li>Force re-process semua pesan</li>
                  <li>Bisa duplikat jika lama tidak dihapus</li>
                  <li>Gunakan jika destination dibersihkan</li>
                </ul>
              </div>
            </label>

            {mode === 'OVERWRITE' && (
                <div style={{ marginLeft: '32px', padding: '16px', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    <p style={{ margin: '0 0 12px 0', color: 'var(--danger)', fontWeight: 600, fontSize: '0.85rem' }}>Peringatan Ekstrem: Centang semua untuk melanjutkan</p>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={check1} onChange={e => setCheck1(e.target.checked)} />
                        Saya mengerti risiko limitasi API karena pengiriman massal
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={check2} onChange={e => setCheck2(e.target.checked)} />
                        Saya sudah menghapus pesan lama di destination
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={check3} onChange={e => setCheck3(e.target.checked)} />
                        Saya tidak akan menggunakan akun ini selama proses berlangsung
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
                <strong style={{ display: 'block', color: 'var(--warning)', marginBottom: '4px' }}>SMART SYNC — Sinkronisasi dengan validasi</strong>
                <ul style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  <li>Adaptive sampling untuk mendeteksi pesan yang dihapus</li>
                  <li>Balance antara kecepatan dan keakuratan</li>
                  <li>Gunakan jika curiga ada yang terhapus di tujuan</li>
                </ul>
              </div>
            </label>
          </div>
        </div>
        
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '12px'
        }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" disabled={!isOverwriteValid} onClick={() => onConfirm(mode)}>
            <Play size={16} style={{ marginRight: '8px' }} />
            Lanjutkan Re-run
          </button>
        </div>
      </div>
    </div>
  );
}
