import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  ArrowRightLeft,
  ClipboardCheck,
  Inbox,
  ListChecks,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { jobsDecisionInbox, jobsList } from '../../lib/db/jobsApi';
import { getForwarderFeatureFlags, type ForwarderFeatureFlags } from '../../lib/forwarder';

type ForwarderOverviewProps = {
  onCreateJob: () => void;
  onOpenJobs: () => void;
  onOpenDecisions: () => void;
};

type OverviewData = {
  jobs: any[];
  decisionCount: number;
  flags: ForwarderFeatureFlags;
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
      const [jobs, decisions, flags] = await Promise.all([
        jobsList(),
        jobsDecisionInbox(),
        getForwarderFeatureFlags(),
      ]);
      setData({ jobs, decisionCount: decisions.length, flags });
    } catch (error) {
      console.warn('Unable to load Forwarder overview', error);
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

  const attentionCount = Math.max(data?.decisionCount || 0, summary.waiting.length);
  const nextAction = attentionCount
    ? { label: t('jobs.forwarder_overview_open_decisions'), action: onOpenDecisions, icon: Inbox }
    : summary.jobs.length
      ? { label: t('jobs.forwarder_overview_open_jobs'), action: onOpenJobs, icon: ListChecks }
      : { label: t('jobs.forwarder_overview_create_job'), action: onCreateJob, icon: Plus };
  const NextActionIcon = nextAction.icon;

  return (
    <section className="ag-forwarder-overview" aria-live="polite">
      <header className="ag-forwarder-overview-hero">
        <div className="ag-forwarder-overview-copy">
          <span className="ag-forwarder-kicker">
            <ArrowRightLeft size={15} aria-hidden="true" />
            {t('jobs.forwarder_overview_kicker')}
          </span>
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
        <div className="ag-forwarder-inline-error" role="alert">
          <span>{t('jobs.forwarder_overview_load_error')}</span>
          <button type="button" onClick={() => void load()}>{t('jobs.forwarder_overview_try_again')}</button>
        </div>
      )}

      <div className="ag-forwarder-summary-grid" aria-busy={isLoading}>
        <article className="ag-forwarder-summary-card">
          <span>{t('jobs.forwarder_overview_stat_active')}</span>
          <strong className={isLoading ? 'is-loading' : undefined}>
            {isLoading ? <span aria-hidden="true" /> : summary.active.length}
          </strong>
          <small>{t('jobs.forwarder_overview_stat_active_help')}</small>
        </article>
        <article className="ag-forwarder-summary-card">
          <span>{t('jobs.forwarder_overview_stat_attention')}</span>
          <strong className={isLoading ? 'is-loading' : undefined}>
            {isLoading ? <span aria-hidden="true" /> : attentionCount}
          </strong>
          <small>{t('jobs.forwarder_overview_stat_attention_help')}</small>
        </article>
        <article className="ag-forwarder-summary-card">
          <span>{t('jobs.forwarder_overview_stat_completed')}</span>
          <strong className={isLoading ? 'is-loading' : undefined}>
            {isLoading ? <span aria-hidden="true" /> : summary.completed}
          </strong>
          <small>{t('jobs.forwarder_overview_stat_completed_help')}</small>
        </article>
      </div>

      <div className="ag-forwarder-overview-layout">
        <section className="ag-forwarder-overview-panel ag-forwarder-next-panel">
          <div className="ag-forwarder-panel-heading">
            <div className="ag-forwarder-panel-icon"><ClipboardCheck size={18} aria-hidden="true" /></div>
            <div>
              <h2>{t('jobs.forwarder_overview_next_title')}</h2>
              <p>{t('jobs.forwarder_overview_next_description')}</p>
            </div>
          </div>
          <button type="button" className="ag-forwarder-next-action" onClick={nextAction.action}>
            <span><NextActionIcon size={17} aria-hidden="true" />{nextAction.label}</span>
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </section>

        <section className="ag-forwarder-overview-panel ag-forwarder-guardrail-panel">
          <div className="ag-forwarder-panel-heading">
            <div className="ag-forwarder-panel-icon"><ShieldCheck size={18} aria-hidden="true" /></div>
            <div>
              <h2>{t('jobs.forwarder_overview_guardrail_title')}</h2>
              <p>{t('jobs.forwarder_overview_guardrail_description')}</p>
            </div>
          </div>
          <span className={`ag-forwarder-feature-state${data?.flags.forwarder_v2 ? ' is-ready' : ''}`}>
            {data?.flags.forwarder_v2
              ? t('jobs.forwarder_overview_guardrail_ready')
              : t('jobs.forwarder_overview_guardrail_unavailable')}
          </span>
        </section>
      </div>

      <section className="ag-forwarder-overview-panel ag-forwarder-recent-panel">
        <div className="ag-forwarder-recent-heading">
          <div>
            <h2>{t('jobs.forwarder_overview_recent_title')}</h2>
            <p>{t('jobs.forwarder_overview_recent_description')}</p>
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
        ) : summary.jobs.length === 0 ? (
          <div className="ag-forwarder-empty-overview">
            <ArrowRightLeft size={26} aria-hidden="true" />
            <h3>{t('jobs.forwarder_overview_empty_title')}</h3>
            <p>{t('jobs.forwarder_overview_empty_description')}</p>
            <button type="button" onClick={onCreateJob}>{t('jobs.forwarder_overview_empty_action')}</button>
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
    </section>
  );
}
