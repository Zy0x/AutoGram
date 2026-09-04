import { Play, Pause, Trash2, Edit3, Plus, ArrowRightLeft, RefreshCw, Upload, Download, Eye, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { RerunModal } from '../Modals/RerunModal';
import {
  resolveJobUiKind,
  jobStatusClass,
  jobDisplayStatus,
  getPrimaryActions,
  startArgsForAction,
  normalizeJobStatus,
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
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'attention' | 'completed' | 'failed'>('all');

  const filteredJobs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return jobs.filter((job) => {
      const status = normalizeJobStatus(job.status);
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' && !['COMPLETED', 'CANCELLED', 'FAILED', 'PARTIAL_SUCCESS', 'WAITING_USER'].includes(status))
        || (statusFilter === 'attention' && status === 'WAITING_USER')
        || (statusFilter === 'completed' && status === 'COMPLETED')
        || (statusFilter === 'failed' && ['FAILED', 'CANCELLED', 'PARTIAL_SUCCESS'].includes(status));
      if (!matchesStatus) return false;
      if (!query) return true;
      let config: any = {};
      try { config = typeof job.config_json === 'string' ? JSON.parse(job.config_json) : job.config_json || {}; } catch { /* ignore malformed legacy config */ }
      const searchable = [
        job.job_name,
        job.profile_name,
        job.transfer_mode,
        job.source_entity_id,
        job.target_entity_id,
        config.sourceName,
        config.destName,
      ].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(query);
    });
  }, [jobs, searchQuery, statusFilter]);

  return (
    <div className="jobs-workspace">
      <header className="page-toolbar">
        <div className="page-toolbar-title">
          <h1 className="title-gradient">{t('jobs.forwarder_tab_jobs')}</h1>
          <p>
            {t('jobs.forwarder_overview_description')}
          </p>
        </div>
        <div className="page-toolbar-actions">
          <button type="button" className="btn btn-secondary" onClick={importJobs} title={t("jobs.jobs_import_title")}>
            <Download size={16} /> <span>{t('ui.generated.import_d6fbc9d')}</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={exportJobs} title={t("jobs.jobs_export_title")}>
            <Upload size={16} /> <span>{t('ui.generated.export_f3e4fad')}</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={fetchJobs} disabled={isLoading} title={t('drive.sidebar_btn_refresh')}>
            <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
          </button>
          <button type="button" className="btn btn-primary" onClick={onNewJob}>
            <Plus size={18} /> {t('ui.generated.new_job_2430811')}
          </button>
        </div>
      </header>

      <div className="ag-forwarder-job-filters" role="search">
        <label className="ag-forwarder-job-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">{t('jobs.forwarder_jobs_search_label')}</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('jobs.forwarder_jobs_search_placeholder')}
          />
        </label>
        <label className="ag-forwarder-job-status-filter">
          <span>{t('jobs.forwarder_jobs_filter_label')}</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">{t('jobs.forwarder_jobs_filter_all')}</option>
            <option value="active">{t('jobs.forwarder_jobs_filter_active')}</option>
            <option value="attention">{t('jobs.forwarder_jobs_filter_attention')}</option>
            <option value="completed">{t('jobs.forwarder_jobs_filter_completed')}</option>
            <option value="failed">{t('jobs.forwarder_jobs_filter_failed')}</option>
          </select>
        </label>
      </div>

      {jobs.length === 0 && !isLoading ? (
        <div className="glass-panel empty-state-panel">
          <div className="empty-state-icon">
            <ArrowRightLeft size={40} />
          </div>
          <h2>{t('ui.generated.belum_ada_job_forwarder_dcdf0fa')}</h2>
          <p>
            {t('ui.generated.buat_job_sumber_tujuan_pilih_mode_forward_atau_c_c8cb623')}
          </p>
          <button type="button" className="btn btn-primary" onClick={onNewJob}>
            <Plus size={18} /> {t('ui.generated.buat_job_pertama_2f43957')}
          </button>
        </div>
      ) : filteredJobs.length === 0 && !isLoading ? (
        <div className="glass-panel empty-state-panel ag-forwarder-filter-empty">
          <Search size={30} aria-hidden="true" />
          <h2>{t('jobs.forwarder_jobs_filter_empty_title')}</h2>
          <p>{t('jobs.forwarder_jobs_filter_empty_description')}</p>
        </div>
      ) : (
        <div className="cards-grid jobs-cards-scroll">
          {filteredJobs.map((job) => {
            const isRunning = !!activeCommands[job.id];
            const result = runResults[job.id];

            const total = job.total_messages || 0;
            const processed = job.processed_messages || 0;
            const failedHint = Number(job.failed_messages || job.failed_count || 0) || 0;

            const uiKind = resolveJobUiKind(job, { isRunning, runResult: result });
            const statusClass = jobStatusClass(uiKind);
            const rawStatus = normalizeJobStatus(job.status);
            const nativeStages = new Set(['SCANNING', 'FORWARDING', 'DOWNLOADING', 'UPLOADING', 'COMMITTING']);
            const nativeStage = nativeStages.has(rawStatus) ? rawStatus.toLowerCase() : '';
            const displayStatus = nativeStage
              ? t(`jobs.stage_${nativeStage}`)
              : jobDisplayStatus(uiKind, job.status);
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
                    <Pause size={18} /> {t('jobs.action_pause')}
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
                    <Play size={18} /> {t('jobs.action_resume')}
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
                    <Play size={18} /> {t('jobs.action_run')}
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
                        ? t('jobs.retry_failed_tooltip')
                        : t('jobs.retry_unavailable_tooltip')
                    }
                  >
                    <RefreshCw size={18} /> {t('jobs.action_retry_failed', { count: failedHint || '' })}
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
                  <Play size={18} /> {t('jobs.action_rerun')}
                </button>
              );
            };

            return (
              <div
                key={job.id}
                className={`job-card glass-panel job-card-shell ${statusClass}`}
              >
                <div className={`job-card-status-bar status-${nativeStage || statusClass}`} />

                <div className="job-card-header">
                  <div style={{ width: '100%', minWidth: 0, maxWidth: '100%' }}>
                    <div className="job-card-title-row">
                      <h3>{job.job_name || t('jobs.forwarder_overview_untitled_job', { id: job.id })}</h3>
                      <span className={`modern-badge ${statusClass}${nativeStage ? ` stage-${nativeStage}` : ''}`}>{displayStatus}</span>
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
                    {t('ui.generated.profile_17d487b')} <strong>{job.profile_name}</strong>
                  </span>
                  <span className="job-tag">
                    {t('ui.generated.mode_fbb6d6f')} <strong>{job.transfer_mode}</strong>
                  </span>
                </div>

                <div className="job-progress-block">
                  <div className="job-progress-meta">
                    <span>
                      {processed} / {total || '?'} {t('ui.generated.messages_17f3467')}
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
          jobName={selectedJobForRerun.job_name || t('jobs.forwarder_overview_untitled_job', { id: selectedJobForRerun.id })}
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
