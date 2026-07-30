import { Play, Pause, Trash2, Edit3, Plus, Terminal, RefreshCw, Upload, Download, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { RerunModal } from '../Modals/RerunModal';
import {
  resolveJobUiKind,
  jobStatusClass,
  jobDisplayStatus,
  getPrimaryActions,
  startArgsForAction,
} from '../../../lib/db/jobStatus';

interface JobsListProps {
  jobs: any[];
  isLoading: boolean;
  activeCommands: {[key: number]: any};
  runResults: {[key: number]: 'success' | 'failed' | undefined};
  fetchJobs: () => void;
  importJobs: () => void;
  exportJobs: () => void;
  startJob: (job: any, isRetry?: boolean, isDryRun?: boolean, rerunMode?: string) => void;
  pauseJob: (jobId: number) => void;
  deleteJob: (jobId: number) => void;
  onNewJob: () => void;
  onViewRuntime: (job: any) => void;
  onEditJob: (job: any) => void;
}

export function JobsList({
  jobs,
  isLoading,
  activeCommands,
  runResults,
  fetchJobs,
  importJobs,
  exportJobs,
  startJob,
  pauseJob,
  deleteJob,
  onNewJob,
  onViewRuntime,
  onEditJob
}: JobsListProps) {
  const { t } = useTranslation();
  const [selectedJobForRerun, setSelectedJobForRerun] = useState<any>(null);

  return (
    <div className="jobs-workspace">
      <header className="page-toolbar">
        <div className="page-toolbar-title">
          <h1 className="title-gradient">Forwarder</h1>
          <p>
            Migrasi chat: Forward cepat atau Clean Copy (re-upload + dedupe 4 level + resume).
            Bisa jalan paralel dengan Drives pada session yang sama.
          </p>
        </div>
        <div className="page-toolbar-actions">
          <button type="button" className="btn btn-secondary" onClick={importJobs} title={t("jobs.jobs_import_title")}>
            <Download size={16} /> <span>Import</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={exportJobs} title={t("jobs.jobs_export_title")}>
            <Upload size={16} /> <span>Export</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={fetchJobs} disabled={isLoading} title="Refresh">
            <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
          </button>
          <button type="button" className="btn btn-primary" onClick={onNewJob}>
            <Plus size={18} /> New Job
          </button>
        </div>
      </header>

      {jobs.length === 0 && !isLoading ? (
        <div className="glass-panel empty-state-panel">
          <div className="empty-state-icon">
            <Terminal size={40} />
          </div>
          <h2>Belum ada job Forwarder</h2>
          <p>
            Buat job sumber → tujuan: pilih mode Forward atau Clean Copy, lalu jalankan.
            Pastikan akun sudah aktif di Accounts.
          </p>
          <button type="button" className="btn btn-primary" onClick={onNewJob}>
            <Plus size={18} /> Buat Job Pertama
          </button>
        </div>
      ) : (
        <div className="cards-grid jobs-cards-scroll">
          {jobs.map((job) => {
            const isRunning = !!activeCommands[job.id];
            const result = runResults[job.id];

            const total = job.total_messages || 0;
            const processed = job.processed_messages || 0;
            const failedHint = Number(job.failed_messages || job.failed_count || 0) || 0;

            const uiKind = resolveJobUiKind(job, { isRunning, runResult: result });
            const statusClass = jobStatusClass(uiKind);
            const displayStatus = jobDisplayStatus(uiKind, job.status);
            const primaryActions = getPrimaryActions(uiKind, failedHint);

            let percentLabel = '0.0%';
            let percentWidth = '0%';
            if (total > 0) {
              const p = Math.min(100, (processed / total) * 100);
              percentLabel = `${p.toFixed(1)}%`;
              percentWidth = `${p}%`;
            } else if (processed > 0) {
              percentLabel = uiKind === 'paused' ? '…' : '100%';
              percentWidth = uiKind === 'paused' ? '0%' : '100%';
            }

            let parsedConfig: any = {};
            try {
              if (job.config_json) {
                parsedConfig = typeof job.config_json === 'string' ? JSON.parse(job.config_json) : job.config_json;
              }
            } catch {
              /* ignore */
            }

            const sourceLabel = parsedConfig.sourceName || job.source_entity_id;
            const targetLabel = parsedConfig.destName || job.target_entity_id;

            const busy = !!activeCommands[job.id];

            const renderPrimary = (action: (typeof primaryActions)[0]) => {
              if (action.kind === 'pause') {
                return (
                  <button
                    key="pause"
                    type="button"
                    className="btn btn-secondary btn-warning-soft"
                    onClick={() => pauseJob(job.id)}
                    title={t('jobs.pause_execution')}
                  >
                    <Pause size={18} /> {action.label}
                  </button>
                );
              }
              if (action.kind === 'resume') {
                const args = startArgsForAction('resume');
                return (
                  <button
                    key="resume"
                    type="button"
                    className="btn btn-primary"
                    onClick={() => startJob(job, args.isRetry, args.isDryRun, args.rerunMode)}
                    disabled={busy}
                    title={t('jobs.resume_from_checkpoint')}
                  >
                    <Play size={18} /> {action.label}
                  </button>
                );
              }
              if (action.kind === 'run') {
                const args = startArgsForAction('run');
                return (
                  <button
                    key="run"
                    type="button"
                    className="btn btn-primary"
                    onClick={() => startJob(job, args.isRetry, args.isDryRun, args.rerunMode)}
                    disabled={busy}
                    title={t("jobs.jobs_resume_exec")}
                  >
                    <Play size={18} /> {action.label}
                  </button>
                );
              }
              if (action.kind === 'retry-failed') {
                const args = startArgsForAction('retry-failed');
                return (
                  <button
                    key="retry-failed"
                    type="button"
                    className="btn btn-primary"
                    onClick={() => startJob(job, args.isRetry, args.isDryRun, args.rerunMode)}
                    disabled={busy || !job.last_execution_id}
                    title={
                      job.last_execution_id
                        ? 'Ulangi hanya pesan yang gagal (retry-execution RESUME)'
                        : 'Tidak ada execution sebelumnya untuk retry'
                    }
                  >
                    <RefreshCw size={18} /> {action.label}
                  </button>
                );
              }
              // rerun → modal (RESUME / OVERWRITE / SMART_SYNC)
              return (
                <button
                  key="rerun"
                  type="button"
                  className="btn btn-secondary btn-primary-outline"
                  onClick={() => setSelectedJobForRerun(job)}
                  disabled={busy}
                  title={t("jobs.jobs_rerun_modes_title")}
                >
                  <Play size={18} /> {action.label}
                </button>
              );
            };

            return (
              <div
                key={job.id}
                className={`job-card glass-panel job-card-shell ${statusClass}`}
              >
                <div className={`job-card-status-bar status-${statusClass}`} />

                <div className="job-card-header">
                  <div style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}>
                    <div className="job-card-title-row">
                      <h3>{job.job_name || `Migration #${job.id}`}</h3>
                      <span className={`modern-badge ${statusClass}`}>{displayStatus}</span>
                    </div>
                    <div className="job-route" title={`${sourceLabel} → ${targetLabel}`}>
                      <span>{sourceLabel}</span>
                      <span className="route-arrow" aria-hidden>→</span>
                      <span>{targetLabel}</span>
                    </div>
                  </div>
                </div>

                <div className="job-tags">
                  <span className="job-tag">
                    Profile: <strong>{job.profile_name}</strong>
                  </span>
                  <span className="job-tag">
                    Mode: <strong>{job.transfer_mode}</strong>
                  </span>
                </div>

                <div className="job-progress-block">
                  <div className="job-progress-meta">
                    <span>
                      {processed} / {total || '?'} messages
                    </span>
                    <span className={`job-progress-pct status-text-${statusClass}`}>{percentLabel}</span>
                  </div>
                  <div className="job-progress-track">
                    <div
                      className={`job-progress-bar status-bg-${statusClass}`}
                      style={{ width: percentWidth === '0%' && percentLabel === '…' ? '15%' : percentWidth }}
                    />
                  </div>
                </div>

                <div className="job-card-actions">
                  {primaryActions.map((a: any) => renderPrimary(a))}
                  <button
                    type="button"
                    className="btn btn-secondary btn-icon"
                    onClick={() => onViewRuntime(job)}
                    title={t("jobs.jobs_view_config")}
                  >
                    <Eye size={18} />
                  </button>
                  {!isRunning && (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon"
                        onClick={() => onEditJob(job)}
                        title={t("jobs.jobs_edit_config")}
                      >
                        <Edit3 size={18} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon btn-danger-soft"
                        onClick={() => deleteJob(job.id)}
                        title={t("jobs.jobs_delete_title")}
                      >
                        <Trash2 size={18} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedJobForRerun && (
        <RerunModal
          jobName={selectedJobForRerun.job_name || `Migration #${selectedJobForRerun.id}`}
          successCount={selectedJobForRerun.processed_messages || 0}
          onClose={() => setSelectedJobForRerun(null)}
          onConfirm={(mode) => {
            const job = selectedJobForRerun;
            setSelectedJobForRerun(null);
            // Re-run always uses retry-execution + chosen mode (RESUME / OVERWRITE / SMART_SYNC)
            startJob(job, true, false, mode);
          }}
        />
      )}
    </div>
  );
}
