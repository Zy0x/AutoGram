import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Copy, Download, Link2, Search, FileDown, Pencil, Trash2 } from 'lucide-react';
import { MAX_LINKS, type CrawlEntry, type CrawlRecord } from '../domain/types';
import { removeCrawlerEntries, renameCrawlerEntry, setCrawlerSelection } from '../state/workspace';

const PAGE_SIZE = 100;
interface Props {
  record: CrawlRecord;
  busy: boolean;
  onCopy: (entries: CrawlEntry[]) => void;
  onDownload: (entries: CrawlEntry[]) => void;
  onUse: (entries: CrawlEntry[]) => void;
  onExport: (format: 'json' | 'txt' | 'csv') => void;
}

function sourceOrigin(entry: CrawlEntry): string {
  try { return new URL(entry.sourceUrl || entry.url).origin; } catch { return ''; }
}

export function CrawlerResults({ record, busy, onCopy, onDownload, onUse, onExport }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [format, setFormat] = useState<'json' | 'txt' | 'csv'>('json');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return record.snapshot.entries.slice(0, MAX_LINKS).filter(entry => !needle ||
      entry.filename.toLocaleLowerCase().includes(needle) || entry.kind.includes(needle) ||
      t(`crawler.kind_${entry.kind}`).toLocaleLowerCase().includes(needle));
  }, [record.snapshot.entries, query, t]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = useMemo(() => filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), [filtered, currentPage]);
  const selectedIds = new Set(record.selected);
  const selected = visible.filter(entry => selectedIds.has(entry.id));
  const eligibleForDownload = selected.length > 0 && selected.length <= 100 &&
    selected.every(entry => entry.kind !== 'page' && entry.kind !== 'manifest');

  useEffect(() => {
    // Never retain hidden selections after a search, page change or snapshot update.
    const visibleIds = new Set(visible.map(entry => entry.id));
    const safe = record.selected.filter(entryId => visibleIds.has(entryId));
    if (safe.length !== record.selected.length) setCrawlerSelection(record.id, safe);
  }, [record.id, record.selected, visible]);

  const changePage = (next: number) => {
    setCrawlerSelection(record.id, []);
    setPage(next);
  };
  const toggle = (entryId: string, checked: boolean) => {
    const ids = selected.map(entry => entry.id);
    setCrawlerSelection(record.id, checked ? [...new Set([...ids, entryId])] : ids.filter(value => value !== entryId));
  };

  return <section className="crawler-results" aria-labelledby={`${id}-title`}>
    <div className="crawler-section-head">
      <div><h3 id={`${id}-title`}>{t('crawler.results')}</h3>
        <p className="crawler-hint">{t('crawler.result_count', { count: record.snapshot.entries.length, max: MAX_LINKS })}</p></div>
      <span className="crawler-badge">{t(record.native ? 'crawler.discovered_urls' : 'crawler.unverified_urls')}</span>
    </div>
    <div className="crawler-result-tools">
      <label className="crawler-search" htmlFor={`${id}-search`}>
        <Search size={17} aria-hidden="true" />
        <span className="crawler-sr-only">{t('crawler.search')}</span>
        <input id={`${id}-search`} type="search" value={query} placeholder={t('crawler.search')}
          onChange={event => { setQuery(event.target.value); setPage(0); setCrawlerSelection(record.id, []); }} />
      </label>
      <button type="button" disabled={!visible.length} onClick={() => setCrawlerSelection(record.id, visible.map(entry => entry.id))}>
        {t('crawler.select_visible')}
      </button>
      <button type="button" disabled={!selected.length} onClick={() => setCrawlerSelection(record.id, [])}>{t('crawler.clear_selection')}</button>
    </div>
    <p className="crawler-hint" id={`${id}-selection-hint`}>{t('crawler.selection_scope')}</p>
    <div className="crawler-result-list" aria-describedby={`${id}-selection-hint`}>
      <div className="crawler-table-head" aria-hidden="true"><span />
        <span>{t('crawler.filename_source')}</span><span>{t('crawler.type')}</span></div>
      {visible.map(entry => <label key={entry.id} className={`crawler-result-row${selectedIds.has(entry.id) ? ' is-selected' : ''}`}>
        <span className="crawler-row-check"><input type="checkbox" checked={selectedIds.has(entry.id)}
          aria-label={t('crawler.select_url', { name: entry.filename || t('crawler.unnamed_url') })}
          onChange={event => toggle(entry.id, event.target.checked)} /></span>
        <span className="crawler-file"><strong>{entry.filename || t('crawler.unnamed_url')}</strong>
          <small>{sourceOrigin(entry) || t('crawler.unknown_origin')}</small></span>
        <span className={`crawler-kind crawler-kind-${entry.kind}`}>{t(`crawler.kind_${entry.kind}`)}</span>
        <span className="crawler-row-actions">
          <button type="button" title={t('crawler.rename')} aria-label={t('crawler.rename_url', { name: entry.filename || t('crawler.unnamed_url') })}
            onClick={event => { event.preventDefault(); const value = window.prompt(t('crawler.rename_prompt'), entry.filename); if (value !== null) renameCrawlerEntry(record.id, entry.id, value); }}>
            <Pencil size={14} aria-hidden="true" />
          </button>
          <button type="button" title={t('crawler.remove')} aria-label={t('crawler.remove_url', { name: entry.filename || t('crawler.unnamed_url') })}
            onClick={event => { event.preventDefault(); if (window.confirm(t('crawler.remove_confirm'))) removeCrawlerEntries(record.id, [entry.id]); }}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </span>
      </label>)}
      {!visible.length && <div className="crawler-empty"><Search size={28} aria-hidden="true" />
        <h4>{t(query ? 'crawler.no_matches' : 'crawler.no_results')}</h4>
        <p>{t(query ? 'crawler.no_matches_hint' : 'crawler.no_results_hint')}</p></div>}
    </div>
    <nav className="crawler-pagination" aria-label={t('crawler.pagination')}>
      <span>{t('crawler.page_info', { page: currentPage + 1, pages, count: filtered.length })}</span>
      <div><button type="button" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)} aria-label={t('crawler.previous_page')}>
        <ChevronLeft size={18} aria-hidden="true" /></button>
      <button type="button" disabled={currentPage >= pages - 1} onClick={() => changePage(currentPage + 1)} aria-label={t('crawler.next_page')}>
        <ChevronRight size={18} aria-hidden="true" /></button></div>
    </nav>
    <footer className="crawler-result-actions">
      <p className="crawler-selection-count" role="status">{t('crawler.selected_count', { count: selected.length })}</p>
      <div className="crawler-action-buttons">
        <button type="button" className="crawler-primary" disabled={busy || !selected.length || selected.length > 100}
          onClick={() => onUse(selected)}><Link2 size={16} aria-hidden="true" />{t('crawler.use_links')}</button>
        <button type="button" disabled={busy || !eligibleForDownload} onClick={() => onDownload(selected)}
          aria-describedby={`${id}-download-hint`}><Download size={16} aria-hidden="true" />{t('crawler.download')}</button>
        <button type="button" disabled={busy || !selected.length} onClick={() => onCopy(selected)}>
          <Copy size={16} aria-hidden="true" />{t('crawler.copy')}</button>
      </div>
      <p className="crawler-hint" id={`${id}-download-hint`}>{t(selected.some(entry => entry.kind === 'page' || entry.kind === 'manifest')
        ? 'crawler.resolver_hint' : 'crawler.download_hint')}</p>
      <div className="crawler-export">
        <label htmlFor={`${id}-format`}>{t('crawler.export_format')}</label>
        <select id={`${id}-format`} value={format} onChange={event => setFormat(event.target.value as typeof format)}>
          {(['json', 'txt', 'csv'] as const).map(value => <option key={value} value={value}>{t(`crawler.format_${value}`)}</option>)}
        </select>
        <button type="button" disabled={busy || !record.snapshot.entries.length} onClick={() => onExport(format)}>
          <FileDown size={16} aria-hidden="true" />{t('crawler.export_all')}</button>
      </div>
    </footer>
  </section>;
}
