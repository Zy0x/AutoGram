import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox, RefreshCw, ShieldAlert } from 'lucide-react';
import { jobsDecisionInbox, jobsResolveDecision, type DecisionInboxRow } from '../../lib/db/jobsApi';

export function DecisionInbox() {
  const { t } = useTranslation();
  const [items, setItems] = useState<DecisionInboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      setItems(await jobsDecisionInbox());
    } catch (error) {
      console.warn('Unable to load Forwarder decisions', error);
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const resolve = async (decisionId: number, decision: string) => {
    try {
      await jobsResolveDecision(decisionId, decision);
      await refresh();
    } catch (error) {
      console.warn('Unable to resolve Forwarder decision', error);
      setHasError(true);
    }
  };

  return (
    <section className="ag-forwarder-decision-inbox" aria-live="polite">
      <header className="ag-forwarder-decision-header">
        <div>
          <span className="ag-forwarder-kicker"><Inbox size={15} aria-hidden="true" />{t('jobs.decision_inbox_kicker')}</span>
          <h1>{t('jobs.decision_inbox_title')}</h1>
          <p>{t('jobs.decision_inbox_description')}</p>
        </div>
        <button
          type="button"
          className="ag-forwarder-icon-action"
          onClick={() => void refresh()}
          disabled={loading}
          title={t('jobs.decision_inbox_refresh')}
          aria-label={t('jobs.decision_inbox_refresh')}
        >
          <RefreshCw size={17} className={loading ? 'spin' : ''} aria-hidden="true" />
        </button>
      </header>
      {hasError && <p className="ag-forwarder-inline-error" role="alert">{t('jobs.decision_inbox_error')}</p>}
      {loading && <div className="ag-forwarder-decision-skeleton"><span /><span /><span /></div>}
      {!loading && items.length === 0 && (
        <div className="ag-forwarder-decision-empty">
          <Inbox size={28} aria-hidden="true" />
          <h2>{t('jobs.decision_inbox_empty')}</h2>
          <p>{t('jobs.decision_inbox_empty_description')}</p>
        </div>
      )}
      {!loading && items.map((item) => (
        <article key={item.id} className="ag-forwarder-decision-item">
          <div className="ag-forwarder-decision-icon"><ShieldAlert size={19} aria-hidden="true" /></div>
          <div className="ag-forwarder-decision-copy">
            <strong>{item.reasonCode}</strong>
            <span>{t('jobs.decision_inbox_item_type', { type: item.decisionType })}</span>
          </div>
          <div className="ag-forwarder-decision-actions">
            <button type="button" onClick={() => void resolve(item.id, 'skip')}>{t('jobs.decision_skip')}</button>
            <button type="button" onClick={() => void resolve(item.id, 'keep_both')}>{t('jobs.decision_keep_both')}</button>
          </div>
        </article>
      ))}
    </section>
  );
}
