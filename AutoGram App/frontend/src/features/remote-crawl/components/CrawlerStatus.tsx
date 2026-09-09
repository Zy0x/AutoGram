import { Pause, Play, Square, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isCrawlActive, type CrawlRecord } from '../domain/types';

interface Props {
  record: CrawlRecord;
  busy: boolean;
  hasActive: boolean;
  onControl: (action: 'pause' | 'resume' | 'cancel') => void;
  onRescan: () => void;
}

export function CrawlerStatus({ record, busy, hasActive, onControl, onRescan }: Props) {
  const { t } = useTranslation();
  const { snapshot } = record;
  const active = record.native && isCrawlActive(snapshot.state);
  return <section className="crawler-status" aria-label={t('crawler.progress')}>
    <div className="crawler-section-head">
      <div><h2>{record.name || t('crawler.untitled')}</h2>
        <p className="crawler-state" role="status">{t(record.native ? `crawler.state_${snapshot.state}` : 'crawler.saved_links')}</p></div>
      <div className="crawler-status-actions">
        {active && <>
          <button type="button" disabled={busy} onClick={() => onControl(snapshot.state === 'paused' ? 'resume' : 'pause')}>
            {snapshot.state === 'paused' ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            {t(snapshot.state === 'paused' ? 'crawler.resume' : 'crawler.pause')}</button>
          <button type="button" disabled={busy} onClick={() => onControl('cancel')}><Square size={16} aria-hidden="true" />{t('crawler.cancel')}</button>
        </>}
        {record.request && !active && <button type="button" disabled={busy || hasActive} onClick={onRescan}>
          <RefreshCw size={16} aria-hidden="true" />{t('crawler.rescan')}</button>}
      </div>
    </div>
    {record.native && <dl className="crawler-stats">
      {(['pagesVisited', 'pagesQueued', 'duplicates', 'blocked', 'errors'] as const).map(key => <div key={key}>
        <dt>{t(`crawler.${key}`)}</dt><dd>{snapshot[key]}</dd></div>)}
    </dl>}
    {!record.native && <p className="crawler-hint">{t('crawler.snapshot_hint')}</p>}
    {record.request && !active && <p className="crawler-hint">{t('crawler.rescan_hint')}</p>}
    {!!record.baselineUrls.length && <p className="crawler-hint">{t('crawler.delta_hint')}</p>}
    {snapshot.state === 'limited' && <p className="crawler-notice">{t('crawler.limited_hint')}</p>}
    {(snapshot.error || snapshot.state === 'failed') && <p role="alert" className="crawler-notice crawler-error">{t('crawler.crawl_failed')}</p>}
  </section>;
}
