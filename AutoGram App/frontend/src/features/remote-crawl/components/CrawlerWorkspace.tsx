import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Globe2, X, Info } from 'lucide-react';
import { canonicalCrawlUrl, parseLinkText } from '../domain/links';
import { isCrawlActive, type CrawlEntry, type CrawlRequest } from '../domain/types';
import { addLinkBatch, clearCrawlerError, controlCrawl, importCrawlerProject, refreshCrawls,
  selectCrawlerRecord, startCrawl, useCrawlerWorkspace } from '../state/workspace';
import { downloadCrawlerSelection, exportCrawlerFile } from '../services/files';
import { CrawlerSetup } from './CrawlerSetup';
import { CrawlerResults } from './CrawlerResults';
import { CrawlerSidebar } from './CrawlerSidebar';
import { CrawlerStatus } from './CrawlerStatus';
import { useCrawlerDialog } from './useCrawlerDialog';
import '../crawler.css';

export interface CrawlerWorkspaceProps {
  initialUrl?: string;
  onClose: () => void;
  onUseLinks: (urls: string[]) => void;
}

/** Presentation only: native work and session batches belong to the shared workspace. */
export function CrawlerWorkspace({ initialUrl, onClose, onUseLinks }: CrawlerWorkspaceProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const dialogRef = useCrawlerDialog(onClose);
  const fileRef = useRef<HTMLInputElement>(null);
  const operationLock = useRef(false);
  const state = useCrawlerWorkspace();
  const [setup, setSetup] = useState(() => !!initialUrl || !state.activeId);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const record = state.records.find(row => row.id === state.activeId);
  const busy = working || state.busy;
  const hasActive = state.records.some(row => row.native && isCrawlActive(row.snapshot.state));

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refreshCrawls();
      if (!disposed) timer = setTimeout(() => { void poll(); }, 1200);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  const reportError = (failure: unknown) => {
    const code = (failure instanceof Error ? failure.message : typeof failure === 'string' ? failure : '')
      .replace(/^crawler\./, '').replace(/^remote_crawl_/, '');
    // Only locale identifiers are rendered; native messages may contain signed URLs.
    setError(/^[a-z_]{1,80}$/.test(code) && i18n.exists(`crawler.${code}`) ? code : 'operation_failed');
  };
  const run = async (action: () => Promise<void>) => {
    if (operationLock.current) return;
    operationLock.current = true;
    setWorking(true);
    setError(null);
    setNotice(null);
    clearCrawlerError();
    try { await action(); } catch (failure) { reportError(failure); }
    finally { operationLock.current = false; setWorking(false); }
  };
  const start = async (request: CrawlRequest, name: string) => {
    await run(async () => { await startCrawl(request, name); });
  };
  // Successful starts/imports select a new record; failures leave setup intact.
  const previousId = useRef(state.activeId);
  useEffect(() => {
    if (previousId.current !== state.activeId && state.activeId) setSetup(false);
    previousId.current = state.activeId;
  }, [state.activeId]);

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void run(async () => {
      if (file.size > 4 * 1024 * 1024) throw new Error('import_too_large');
      const text = (await file.text()).replace(/^\uFEFF/, '');
      if (/\.json$/i.test(file.name)) importCrawlerProject(text);
      else if (/\.(txt|csv)$/i.test(file.name)) addLinkBatch(t('crawler.default_name_list'), parseLinkText(text));
      else throw new Error('import_format');
    });
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      void run(async () => {
        if (file.size > 4 * 1024 * 1024) throw new Error('import_too_large');
        const text = (await file.text()).replace(/^\uFEFF/, '');
        if (/\.json$/i.test(file.name)) importCrawlerProject(text);
        else if (/\.(txt|csv)$/i.test(file.name)) addLinkBatch(t('crawler.default_name_list'), parseLinkText(text));
        else throw new Error('import_format');
      });
      return;
    }
    const text = event.dataTransfer.getData('text/plain');
    if (text.trim()) addLinkBatch(t('crawler.default_name_list'), parseLinkText(text));
  };
  const selectedUrls = (entries: CrawlEntry[]) => {
    if (!entries.length || entries.length > 100) throw new Error('download_limit');
    return [...new Set(entries.map(entry => canonicalCrawlUrl(entry.url)))];
  };
  const displayedError = error || state.error;
  const errorKey = displayedError && /^[a-z_]{1,80}$/.test(displayedError) && i18n.exists(`crawler.${displayedError}`)
    ? displayedError : 'operation_failed';

  return createPortal(<div className="crawler-backdrop" onSubmit={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
    <div ref={dialogRef} className="crawler-dialog" role="dialog" aria-modal="true" tabIndex={-1}
      onDragOver={event => event.preventDefault()} onDrop={handleDrop}
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
      <header className="crawler-header">
        <div className="crawler-title"><Globe2 size={24} aria-hidden="true" /><div>
          <h1 id={`${id}-title`}>{t('crawler.title')}</h1><p id={`${id}-description`}>{t('crawler.description')}</p>
        </div></div>
        <button type="button" className="crawler-close" onClick={onClose} aria-label={t('crawler.close')}><X size={21} aria-hidden="true" /></button>
      </header>
      <div className="crawler-body">
        <CrawlerSidebar records={state.records} activeId={setup ? null : state.activeId} busy={busy}
          onNew={() => { setSetup(true); setError(null); setNotice(null); clearCrawlerError(); }}
          onSelect={recordId => { selectCrawlerRecord(recordId); setSetup(false); setError(null); setNotice(null); }}
          onImport={() => fileRef.current?.click()} />
        <main className="crawler-main">
          {displayedError && <div className="crawler-notice crawler-error" role="alert"><span>{t(`crawler.${errorKey}`)}</span>
            <button type="button" aria-label={t('crawler.dismiss')} onClick={() => { setError(null); clearCrawlerError(); }}><X size={16} aria-hidden="true" /></button></div>}
          {notice && <p className="crawler-notice" role="status">{t(`crawler.${notice}`)}</p>}
          {setup || !record ? <><div className="crawler-intro"><h2>{t('crawler.setup_title')}</h2><p>{t('crawler.setup_description')}</p></div>
            <CrawlerSetup initialUrl={initialUrl} busy={busy} crawlActive={hasActive} onStart={start}
              onBatch={(name, entries) => { setError(null); setNotice(null); addLinkBatch(name, entries); setSetup(false); }} onError={reportError} /></>
            : <>
              <CrawlerStatus record={record} busy={busy} hasActive={hasActive}
                onControl={action => { void run(() => controlCrawl(record.id, action)); }}
                onRescan={() => { if (record.request) void run(() => startCrawl(record.request!, record.name,
                  [...new Set([...record.baselineUrls, ...record.snapshot.entries.map(entry => entry.url)])], record.id)); }} />
              <CrawlerResults key={record.id} record={record} busy={busy}
                onCopy={entries => { void run(async () => { await navigator.clipboard.writeText(selectedUrls(entries).join('\n')); setNotice('copied'); }); }}
                onDownload={entries => { void run(async () => { selectedUrls(entries); if (await downloadCrawlerSelection(entries)) setNotice('download_started'); }); }}
                onUse={entries => { void run(async () => { onUseLinks(selectedUrls(entries)); onClose(); }); }}
                onExport={format => { void run(() => exportCrawlerFile(record, format)); }} />
            </>}
        </main>
      </div>
      <footer className="crawler-footer"><Info size={16} aria-hidden="true" /><p>{t(hasActive ? 'crawler.background_active' : 'crawler.background_hint')}</p></footer>
      <input ref={fileRef} className="crawler-sr-only" type="file" accept=".json,.txt,.csv,application/json,text/plain,text/csv" tabIndex={-1}
        aria-label={t('crawler.import')} onChange={importFile} />
    </div>
  </div>, document.body);
}

export default CrawlerWorkspace;
