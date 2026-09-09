import { Plus, FolderInput, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CrawlRecord } from '../domain/types';

interface Props {
  records: CrawlRecord[];
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onImport: () => void;
}

export function CrawlerSidebar({ records, activeId, busy, onSelect, onNew, onImport }: Props) {
  const { t } = useTranslation();
  return <aside className="crawler-sidebar" aria-label={t('crawler.batches')}>
    <div className="crawler-sidebar-heading"><Layers size={18} aria-hidden="true" />
      <h3>{t('crawler.batches')}</h3><span className="crawler-badge">{records.length}/8</span></div>
    <button type="button" className="crawler-new" onClick={onNew} disabled={busy}>
      <Plus size={17} aria-hidden="true" />{t('crawler.new_batch')}</button>
    <nav className="crawler-batches" aria-label={t('crawler.batches')}>
      {records.map(record => <button type="button" key={record.id} aria-current={activeId === record.id ? 'true' : undefined}
        className={`crawler-batch${activeId === record.id ? ' is-active' : ''}`} onClick={() => onSelect(record.id)}>
        <strong>{record.name || t('crawler.untitled')}</strong>
        <span>{t(record.native ? `crawler.state_${record.snapshot.state}` : 'crawler.saved_links')}
          <span aria-hidden="true"> · </span>{t('crawler.batch_count', { count: record.snapshot.entries.length })}</span>
      </button>)}
      {!records.length && <p className="crawler-hint">{t('crawler.no_batches')}</p>}
    </nav>
    <button type="button" onClick={onImport} disabled={busy}><FolderInput size={17} aria-hidden="true" />{t('crawler.import')}</button>
    <p className="crawler-hint">{t('crawler.session_hint')}</p>
  </aside>;
}
