
import { AlertTriangle, X, Trash2 } from 'lucide-react';

interface FreshStartModalProps {
  jobName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function FreshStartModal({ jobName, onClose, onConfirm }: FreshStartModalProps) {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div className="glass-panel" style={{
        background: 'var(--bg-panel)',
        borderRadius: 'var(--radius-lg)',
        width: '500px',
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
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--danger)' }}>
            <AlertTriangle size={20} />
            ⚠️ Fresh Start — Konfirmasi
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>
        
        <div style={{ padding: '24px', color: 'var(--text-main)', fontSize: '0.95rem', lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            Anda akan menghapus <strong>SEMUA history mapping</strong> untuk job: <br/>
            <strong style={{ color: 'var(--primary)' }}>{jobName}</strong>
          </p>
          
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)', marginBottom: '20px' }}>
            <strong>Setelah ini:</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: '20px', color: 'var(--danger)' }}>
              <li>Tidak bisa resume dari job sebelumnya</li>
              <li>Tidak bisa deteksi duplikasi dengan job lama</li>
              <li>Reply chain dari job lama tidak bisa direkonstruksi</li>
            </ul>
          </div>
          
          <strong>Gunakan ini hanya jika:</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: '20px', color: 'var(--text-muted)' }}>
            <li>Chat tujuan benar-benar kosong/dihapus semua</li>
            <li>Anda ingin mulai migrasi dari nol</li>
            <li>Anda tidak peduli dengan job sebelumnya</li>
          </ul>
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
          <button className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: 'white' }} onClick={onConfirm}>
            <Trash2 size={16} style={{ marginRight: '8px' }} />
            Ya, Saya Mengerti — Fresh Start
          </button>
        </div>
      </div>
    </div>
  );
}
