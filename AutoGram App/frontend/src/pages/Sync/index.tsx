import { RefreshCw, Play, AlertTriangle } from 'lucide-react';

export function Sync() {
  return (
    <main className="main-content page-stack">
      <header className="page-header">
        <h2 className="title title-with-icon">
          <RefreshCw size={28} color="var(--primary)" aria-hidden />
          Real-Time Sync
        </h2>
        <p className="subtitle">
          Mirror changes from source to destination in real-time (Messages, Edits, Deletions).
        </p>
      </header>

      <div className="glass-panel card empty-state-panel">
        <AlertTriangle size={48} color="var(--warning)" style={{ marginBottom: '1.25rem', opacity: 0.8 }} />
        <h3 style={{ fontSize: 'var(--fs-xl)', marginBottom: '1rem' }}>Fitur dalam Tahap Pengembangan</h3>
        <p>
          Menu <strong>Real-Time Sync</strong> ini disiapkan sebagai wadah khusus untuk pengembangan fitur Mirroring di masa mendatang. Saat ini, sistem sepenuhnya berfokus pada fitur <strong>Forward Massal (Migration)</strong> melalui antrean Pekerjaan (Job Queue) untuk memastikan stabilitas.
        </p>
        <button type="button" className="btn btn-primary" disabled>
          <Play size={18} />
          Start Sync Daemon (Coming Soon)
        </button>
      </div>
    </main>
  );
}
