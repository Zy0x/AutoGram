import { Rocket, Activity, MonitorSmartphone } from 'lucide-react';
import { isDesktop, canUseLocalTelegramWorker } from '../lib/platform';

export function Dashboard() {
  const desktop = isDesktop() && canUseLocalTelegramWorker();

  return (
    <main className="main-content page-stack">
      <header className="page-header">
        <h2 className="title title-with-icon">
          <Rocket size={24} color="var(--primary)" aria-hidden />
          System Overview
        </h2>
        <p className="subtitle">Welcome to AutoGram. Navigate to the Jobs Workspace to start migrating.</p>
      </header>

      <div className="card glass-panel status-hero">
        {desktop ? (
          <Activity size={32} color="var(--primary)" className="status-hero-icon" aria-hidden />
        ) : (
          <MonitorSmartphone size={32} color="var(--accent)" className="status-hero-icon" aria-hidden />
        )}
        <div className="status-hero-body">
          {desktop ? (
            <>
              <h3>Desktop Runtime Ready</h3>
              <p>
                Aplikasi desktop aktif. Gunakan Jobs untuk migrasi, atau Media Studio untuk Drive / transfer
                file. Worker Telegram dijalankan lewat Tauri saat Anda memulai job.
              </p>
            </>
          ) : (
            <>
              <h3>Browser Preview Mode</h3>
              <p>
                Anda membuka UI di browser. Jobs, Accounts, Statistics live, dan Media Studio membutuhkan
                aplikasi desktop AutoGram (Tauri). Gunakan <code>npm run tauri dev</code> untuk fitur penuh.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
