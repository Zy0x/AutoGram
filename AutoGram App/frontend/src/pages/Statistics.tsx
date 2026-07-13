import { useState, useEffect } from 'react';
import { Command } from '@tauri-apps/plugin-shell';
import { Activity, HardDrive, CheckCircle, XCircle, BarChart3, RefreshCw } from 'lucide-react';

export function Statistics() {
  const [stats, setStats] = useState<any>({
    total_jobs: 0,
    total_items: 0,
    total_success: 0,
    total_failed: 0,
    total_bytes: 0
  });
  const [isLoading, setIsLoading] = useState(false);

  const fetchStats = async () => {
    setIsLoading(true);
    try {
      const command = Command.create('python', ['../../worker/daemon.py', '--action', 'stats']);
      const result = await command.execute();
      
      let jsonOutput = "";
      if (result.stdout.includes('[JSON_OUTPUT]')) {
        const parts = result.stdout.split('[JSON_OUTPUT]');
        jsonOutput = parts[parts.length - 1].trim();
      }
      
      if (jsonOutput) {
        setStats(JSON.parse(jsonOutput));
      }
    } catch (err) {
      console.error("Failed to fetch stats", err);
    } finally {
      setIsLoading(false);
    }
  };

  const exportReport = async () => {
    try {
      const command = Command.create('python', ['../../worker/daemon.py', '--action', 'export-csv']);
      await command.execute();
      alert("CSV Report exported to worker/migration_report.csv successfully!");
    } catch (err) {
      console.error("Failed to export report", err);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <main className="main-content">
      <header style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
            <h2 className="title">Platform Statistics</h2>
            <p className="subtitle">Overall migration analytics and storage health.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={exportReport}>
                <HardDrive size={18} /> Export CSV
            </button>
            <button className="btn btn-secondary" onClick={fetchStats} disabled={isLoading}>
                <RefreshCw size={18} className={isLoading ? "spin" : ""} /> Refresh
            </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        <div className="glass-panel card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>Total Jobs</span>
                <Activity size={20} color="var(--primary)" />
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{stats.total_jobs || 0}</div>
        </div>
        
        <div className="glass-panel card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>Processed Media</span>
                <BarChart3 size={20} color="var(--accent)" />
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{stats.total_items || 0}</div>
        </div>

        <div className="glass-panel card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>Success Transfer</span>
                <CheckCircle size={20} color="var(--success)" />
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{stats.total_success || 0}</div>
        </div>

        <div className="glass-panel card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600 }}>Failed Items</span>
                <XCircle size={20} color="var(--danger)" />
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{stats.total_failed || 0}</div>
        </div>
      </div>

      <div className="glass-panel card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
         <div style={{ padding: '20px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '16px' }}>
            <HardDrive size={32} color="var(--primary)" />
         </div>
         <div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Total Storage Processed</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>Amount of data migrated through the platform</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--primary)' }}>{formatBytes(stats.total_bytes)}</div>
         </div>
      </div>
    </main>
  );
}
