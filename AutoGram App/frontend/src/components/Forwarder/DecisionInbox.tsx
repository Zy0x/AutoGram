import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { jobsDecisionInbox, jobsResolveDecision, type DecisionInboxRow } from '../../lib/db/jobsApi';

export function DecisionInbox() {
  const { t } = useTranslation();
  const [items, setItems] = useState<DecisionInboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    setLoading(true);
    try { setItems(await jobsDecisionInbox()); } finally { setLoading(false); }
  };
  useEffect(() => { refresh().catch(() => setLoading(false)); }, []);
  return (
    <section className="ag-forwarder-decision-inbox" aria-live="polite">
      <h2>{t('jobs.decision_inbox_title')}</h2>
      {loading && <p>{t('jobs.decision_inbox_loading')}</p>}
      {!loading && items.length === 0 && <p>{t('jobs.decision_inbox_empty')}</p>}
      {!loading && items.map((item) => (
        <article key={item.id} className="ag-forwarder-decision-item">
          <div>
            <strong>{item.reasonCode}</strong>
            <span>{item.decisionType}</span>
          </div>
          <div className="ag-forwarder-decision-actions">
            <button type="button" onClick={() => jobsResolveDecision(item.id, 'skip').then(refresh)}>{t('jobs.decision_skip')}</button>
            <button type="button" onClick={() => jobsResolveDecision(item.id, 'keep_both').then(refresh)}>{t('jobs.decision_keep_both')}</button>
          </div>
        </article>
      ))}
    </section>
  );
}
