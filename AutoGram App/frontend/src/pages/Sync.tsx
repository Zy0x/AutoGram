import { RefreshCw, Play, AlertTriangle } from 'lucide-react';

export function Sync() {

  return (
    <main className="main-content">
      <header style={{ marginBottom: '32px' }}>
        <h2 className="title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <RefreshCw size={28} color="var(--primary)" />
          Real-Time Sync
        </h2>
        <p className="subtitle">
          Mirror changes from source to destination in real-time (Messages, Edits, Deletions).
        </p>
      </header>

      <div className="glass-panel card" style={{ textAlign: 'center', padding: '64px 20px' }}>
        <AlertTriangle size={48} color="var(--warning)" style={{ margin: '0 auto 24px', opacity: 0.8 }} />
        <h3 style={{ fontSize: '1.5rem', marginBottom: '16px' }}>Fitur dalam Tahap Pengembangan</h3>
        <p style={{ color: 'var(--text-muted)', maxWidth: '600px', margin: '0 auto 32px', lineHeight: 1.6 }}>
          Menu <strong>Real-Time Sync</strong> ini disiapkan sebagai wadah khusus untuk pengembangan fitur Mirroring di masa mendatang. Saat ini, sistem sepenuhnya berfokus pada fitur <strong>Forward Massal (Migration)</strong> melalui antrean Pekerjaan (Job Queue) untuk memastikan stabilitas.
        </p>
        <button className="btn btn-primary" style={{ padding: '12px 32px', opacity: 0.5, cursor: 'not-allowed' }} disabled>
          <Play size={18} style={{ marginRight: '8px' }} />
          Start Sync Daemon (Coming Soon)
        </button>
      </div>
    </main>
  );
}
