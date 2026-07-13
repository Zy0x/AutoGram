import { Rocket, Activity } from 'lucide-react';

export function Dashboard() {
  
  return (
    <main className="main-content" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h2 className="title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Rocket size={24} color="var(--primary)" /> System Overview
        </h2>
        <p className="subtitle">Welcome to AutoGram. Navigate to the Jobs Workspace to start migrating.</p>
      </header>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '32px', borderLeft: '4px solid var(--primary)' }}>
        <Activity size={32} color="var(--primary)" />
        <div>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '1.2rem' }}>All Systems Operational</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>The daemon is running and ready to process jobs in the background.</p>
        </div>
      </div>
    </main>
  );
}
