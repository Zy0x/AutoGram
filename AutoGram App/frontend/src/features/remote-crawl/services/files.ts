import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import i18n from '../../../i18n';
import { loadTransferSettings } from '../../../lib/telegram/driveTransferSettings';
import { startLocalDownloads, type LocalDownloadRequest } from '../../remote-download/service';
import { canonicalCrawlUrl, classifyCrawlUrl, crawlerCsvCell, exportCrawlerProject, safeCrawlFilename } from '../domain/links';
import type { CrawlEntry, CrawlRecord } from '../domain/types';

export async function exportCrawlerFile(record: CrawlRecord, format: 'json' | 'txt' | 'csv'): Promise<void> {
  const destination = await save({ defaultPath: `${safeCrawlFilename(record.name || 'crawl')}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }] });
  if (!destination) return;
  const body = format === 'json' ? exportCrawlerProject(record)
    : format === 'txt' ? record.snapshot.entries.map(entry => entry.url).join('\n')
    : [['filename', 'kind', 'url', 'sourceUrl'], ...record.snapshot.entries.map(entry => [entry.filename, entry.kind, entry.url, entry.sourceUrl])]
      .map(row => row.map(crawlerCsvCell).join(',')).join('\r\n');
  await writeTextFile(destination, body);
}

export function planCrawlerDownloads(entries: CrawlEntry[], directory: string): LocalDownloadRequest[] {
  if (!entries.length || entries.length > 100) throw new Error('download_limit');
  const filenames = new Set<string>();
  return entries.map(entry => {
    const url = canonicalCrawlUrl(entry.url);
    const inferred = classifyCrawlUrl(url);
    if (entry.kind === 'page' || entry.kind === 'manifest' || inferred === 'manifest') throw new Error('requires_resolver');
    const original = safeCrawlFilename(entry.filename);
    const dot = original.lastIndexOf('.');
    const stem = dot > 0 ? original.slice(0, dot) : original;
    const ext = dot > 0 ? original.slice(dot) : '';
    let filename = original;
    let suffix = 1;
    while (filenames.has(filename.toLowerCase())) filename = `${stem} (${suffix++})${ext}`;
    filenames.add(filename.toLowerCase());
    return { url, filename, directory, connections: loadTransferSettings().downloadConcurrency, referer: canonicalCrawlUrl(entry.sourceUrl) };
  });
}

export async function downloadCrawlerSelection(entries: CrawlEntry[]): Promise<boolean> {
  // Validate before opening a save destination or invoking the native engine.
  planCrawlerDownloads(entries, '');
  const directory = await open({ directory: true, multiple: false, title: i18n.t('crawler.choose_directory') });
  if (typeof directory !== 'string') return false;
  return startLocalDownloads(planCrawlerDownloads(entries, directory));
}
