import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  ArrowRightLeft,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { jobsList } from '../../lib/db/jobsApi';

type ForwarderOverviewProps = {
  onCreateJob: () => void;
  onOpenJobs: () => void;
  onOpenDecisions: () => void;
};

type OverviewData = {
  jobs: any[];
};

const ACTIVE_STATES = new Set([
  'READY',
  'VALIDATING',
  'SCANNING',
  'FILTERING',
  'DEDUPLICATING',
  'DOWNLOADING',
  'PREPARING',
  'UPLOADING',
  'COMMITTING',
  'WAITING_COOLDOWN',
  'RECONCILING',
]);

function jobStatus(job: any) {
  return String(job?.status || 'READY').trim().toUpperCase();
}

function jobName(job: any, fallback: string) {
  return String(job?.job_name || job?.jobName || fallback);
}

function jobRoute(job: any, fallback: string) {
  try {
    const config = typeof job?.config_json === 'string'
      ? JSON.parse(job.config_json)
      : job?.config_json || {};
    const source = config.sourceName || config.source?.peer_id || job?.source_entity_id || fallback;
    const destination = config.destName || config.destination?.peer_id || job?.target_entity_id || fallback;
    return { source: String(source), destination: String(destination) };
  } catch {
    return {
      source: String(job?.source_entity_id || fallback),
      destination: String(job?.target_entity_id || fallback),
    };
  }
}

export function ForwarderOverview({
  onCreateJob,
  onOpenJobs,
  onOpenDecisions,
}: ForwarderOverviewProps) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const jobs = await jobsList();
      setData({ jobs });
    } catch (error) {
      console.warn('Unable to load Forwarder overview', error);
      setData({ jobs: [] });
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const jobs = data?.jobs || [];
    const active = jobs.filter((job) => ACTIVE_STATES.has(jobStatus(job)));
    const waiting = jobs.filter((job) => jobStatus(job) === 'WAITING_USER');
    const completed = jobs.filter((job) => jobStatus(job) === 'COMPLETED').length;
    return { jobs, active, waiting, completed };
  }, [data]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language]
  );

  const attentionCount = summary.waiting.length;

  return (
    <section className="ag-forwarder-overview" aria-live="polite">
      <header className="ag-forwarder-overview-hero">
        <div className="ag-forwarder-overview-copy">
          <h1>{t('jobs.forwarder_overview_title')}</h1>
          <p>{t('jobs.forwarder_overview_description')}</p>
        </div>
        <div className="ag-forwarder-overview-actions">
          <button type="button" className="ag-forwarder-primary-action" onClick={onCreateJob}>
            <Plus size={18} aria-hidden="true" />
            {t('jobs.forwarder_overview_create_job')}
          </button>
          <button
            type="button"
            className="ag-forwarder-icon-action"
            onClick={() => void load()}
            disabled={isLoading}
            title={t('jobs.forwarder_overview_refresh')}
            aria-label={t('jobs.forwarder_overview_refresh')}
          >
            <RefreshCw size={17} className={isLoading ? 'spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </header>

      {hasError && (
        <div className="ag-forwarder-inline-notice" role="status">
          <span>{t('jobs.forwarder_overview_load_error')}</span>
          <button type="button" onClick={() => void load()}>{t('jobs.forwarder_overview_try_again')}</button>
        </div>
      )}

      <section className="ag-forwarder-summary-grid" aria-label={t('jobs.forwarder_overview_recent_description')}>
        <button type="button" className="ag-forwarder-summary-card" onClick={onOpenJobs}>
          <span className="ag-forwarder-summary-label">{t('jobs.forwarder_overview_stat_active')}</span>
          {isLoading ? <span className="ag-forwarder-summary-skeleton" aria-hidden="true" /> : <strong>{summary.active.length}</strong>}
          <span className="ag-forwarder-summary-help">{t('jobs.forwarder_overview_stat_active_help')}</span>
        </button>
        <button type="button" className="ag-forwarder-summary-card is-attention" onClick={onOpenDecisions}>
          <span className="ag-forwarder-summary-label">{t('jobs.forwarder_overview_stat_attention')}</span>
          {isLoading ? <span className="ag-forwarder-summary-skeleton" aria-hidden="true" /> : <strong>{attentionCount}</strong>}
          <span className="ag-forwarder-summary-help">{t('jobs.forwarder_overview_stat_attention_help')}</span>
        </button>
        <button type="button" className="ag-forwarder-summary-card" onClick={onOpenJobs}>
          <span className="ag-forwarder-summary-label">{t('jobs.forwarder_overview_stat_completed')}</span>
          {isLoading ? <span className="ag-forwarder-summary-skeleton" aria-hidden="true" /> : <strong>{summary.completed}</strong>}
          <span className="ag-forwarder-summary-help">{t('jobs.forwarder_overview_stat_completed_help')}</span>
        </button>
      </section>

      {!isLoading && summary.jobs.length === 0 ? (
        <section className="ag-forwarder-empty-overview">
          <ArrowRightLeft size={28} aria-hidden="true" />
          <h2>{t('jobs.forwarder_overview_empty_title')}</h2>
          <p>{t('jobs.forwarder_overview_empty_description')}</p>
          <button type="button" onClick={onCreateJob}>
            <Plus size={17} aria-hidden="true" />
            {t('jobs.forwarder_overview_empty_action')}
          </button>
        </section>
      ) : (
      <section className="ag-forwarder-overview-panel ag-forwarder-recent-panel">
        <div className="ag-forwarder-recent-heading">
          <div>
            <h2>{t('jobs.forwarder_overview_recent_title')}</h2>
            {!isLoading && (
              <div className="ag-forwarder-stat-strip" aria-label={t('jobs.forwarder_overview_recent_description')}>
                <span>{summary.active.length} {t('jobs.forwarder_overview_stat_active')}</span>
                {attentionCount > 0 && <span className="is-attention">{attentionCount} {t('jobs.forwarder_overview_stat_attention')}</span>}
                <span>{summary.completed} {t('jobs.forwarder_overview_stat_completed')}</span>
              </div>
            )}
          </div>
          {summary.jobs.length > 0 && (
            <button type="button" className="ag-forwarder-text-action" onClick={onOpenJobs}>
              {t('jobs.forwarder_overview_view_all')}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="ag-forwarder-recent-skeleton" aria-label={t('jobs.forwarder_overview_loading')}>
            <span /><span /><span />
          </div>
        ) : (
          <div className="ag-forwarder-recent-list">
            {summary.jobs.slice(0, 5).map((job) => {
              const route = jobRoute(job, t('jobs.forwarder_overview_unknown_peer'));
              const status = jobStatus(job);
              const createdAt = job.created_at || job.createdAt;
              const createdLabel = createdAt && !Number.isNaN(new Date(createdAt).getTime())
                ? t('jobs.forwarder_overview_created_on', { date: dateFormatter.format(new Date(createdAt)) })
                : t('jobs.forwarder_overview_created_unknown');
              return (
                <button key={job.id} type="button" className="ag-forwarder-recent-row" onClick={onOpenJobs}>
                  <span className={`ag-forwarder-state-dot state-${status.toLowerCase()}`} aria-hidden="true" />
                  <span className="ag-forwarder-recent-main">
                    <strong>{jobName(job, t('jobs.forwarder_overview_untitled_job', { id: job.id }))}</strong>
                    <span>{route.source}<ArrowRight size={13} aria-hidden="true" />{route.destination}</span>
                  </span>
                  <span className="ag-forwarder-recent-meta">
                    <span className="ag-forwarder-state-label">{t(`jobs.forwarder_overview_state_${status.toLowerCase()}`, { defaultValue: status })}</span>
                    <small>{createdLabel}</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      )}
    </section>
  );
}
