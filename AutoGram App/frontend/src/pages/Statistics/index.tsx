import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import {
  runDaemonOnce,
  isWorkerFailure,
  isDesktopWorkerUnavailable,
  workerErrorMessage,
} from '../../lib/tauri/workerBridge';
import { isDesktop } from '../../lib/tauri/platform';
import { Activity, HardDrive, CheckCircle, XCircle, BarChart3, RefreshCw } from 'lucide-react';

export function Statistics() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<any>({
    total_jobs: 0,
    total_items: 0,
    total_success: 0,
    total_failed: 0,
    total_bytes: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'info' | 'error' | 'ok'>('info');

  const fetchStats = async () => {
    setIsLoading(true);
    setStatusMsg(null);
    try {
      const result = await runDaemonOnce(['--action', 'stats']);

      if (isDesktopWorkerUnavailable(result)) {
        setStatusKind('info');
        setStatusMsg(t('ui.generated.statistik_live_hanya_di_aplikasi_desktop_angka_d_5fb1fce'));
        return;
      }

      let jsonOutput = '';
      if (result.stdout.includes('[JSON_OUTPUT]')) {
        const parts = result.stdout.split('[JSON_OUTPUT]');
        jsonOutput = parts[parts.length - 1].trim();
      }

      if (jsonOutput) {
        setStats(JSON.parse(jsonOutput));
        return;
      }

      if (isWorkerFailure(result)) {
        setStatusKind('error');
        setStatusMsg(workerErrorMessage(result, 'Gagal memuat statistik'));
      }
    } catch (err) {
      console.error('Failed to fetch stats', err);
      setStatusKind('error');
      setStatusMsg(String((err as Error)?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  const exportReport = async () => {
    setStatusMsg(null);
    try {
      const result = await runDaemonOnce(['--action', 'export-csv']);

      if (isDesktopWorkerUnavailable(result) || isWorkerFailure(result)) {
        setStatusKind('error');
        setStatusMsg(workerErrorMessage(result, 'Export CSV gagal'));
        alert(workerErrorMessage(result, 'Export CSV gagal'));
        return;
      }

      setStatusKind('ok');
      setStatusMsg(t('ui.generated.csv_diekspor_ke_worker_migration_report_csv_ec9a325'));
      alert(t('ui.generated.csv_report_exported_to_worker_migration_report_c_1d50852'));
    } catch (err) {
      console.error('Failed to export report', err);
      setStatusKind('error');
      setStatusMsg(String((err as Error)?.message || err));
      alert(`Export failed: ${err}`);
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
    <main className="main-content page-stack">
      <header className="page-header page-header-row">
        <div style={{ minWidth: 0 }}>
          <h2 className="title">{t('statistics.title')}</h2>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            {t('ui.generated.overall_migration_analytics_and_storage_health_31faaee')}
            {!isDesktop() ? t('ui.generated.desktop_app_for_live_data_98a1cb9') : ''}
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-secondary" onClick={exportReport}>
            <HardDrive size={18} /> {t('ui.generated.export_csv_5755f9a')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={fetchStats} disabled={isLoading}>
            <RefreshCw size={18} className={isLoading ? 'spin' : ''} /> {t('speedtest.sidebar_btn_refresh')}
          </button>
        </div>
      </header>

      {statusMsg && (
        <div
          className="glass-panel card"
          role="status"
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            color:
              statusKind === 'error'
                ? 'var(--danger)'
                : statusKind === 'ok'
                  ? 'var(--success)'
                  : 'var(--text-muted)',
          }}
        >
          {statusMsg}
        </div>
      )}

      <div className="stats-grid">
        <div className="glass-panel card stat-card">
          <div className="stat-card-head">
            <span>{t('statistics.total_jobs')}</span>
            <Activity size={20} color="var(--primary)" />
          </div>
          <div className="stat-card-value">{stats.total_jobs || 0}</div>
        </div>

        <div className="glass-panel card stat-card">
          <div className="stat-card-head">
            <span>{t('statistics.processed_media')}</span>
            <BarChart3 size={20} color="var(--accent)" />
          </div>
          <div className="stat-card-value">{stats.total_items || 0}</div>
        </div>

        <div className="glass-panel card stat-card">
          <div className="stat-card-head">
            <span>{t('statistics.success_transfer')}</span>
            <CheckCircle size={20} color="var(--success)" />
          </div>
          <div className="stat-card-value">{stats.total_success || 0}</div>
        </div>

        <div className="glass-panel card stat-card">
          <div className="stat-card-head">
            <span>{t('statistics.failed_items')}</span>
            <XCircle size={20} color="var(--danger)" />
          </div>
          <div className="stat-card-value">{stats.total_failed || 0}</div>
        </div>
      </div>

      <div className="glass-panel card storage-banner">
        <div className="storage-banner-icon">
          <HardDrive size={32} color="var(--primary)" />
        </div>
        <div className="storage-banner-body">
          <h3 style={{ fontSize: 'var(--fs-lg)', marginBottom: '8px' }}>{t('statistics.total_storage')}</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>
            {t('ui.generated.amount_of_data_migrated_through_the_platform_afa584a')}
          </p>
          <div className="stat-card-value accent">{formatBytes(stats.total_bytes)}</div>
        </div>
      </div>
    </main>
  );
}
