import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import { parseCrawlerProject, validateCrawlRequest } from '../domain/links';
import { isCrawlActive, type CrawlEntry, type CrawlRecord, type CrawlRequest, type CrawlSnapshot } from '../domain/types';

interface WorkspaceState { records: CrawlRecord[]; activeId: string | null; busy: boolean; error: string | null }
let state: WorkspaceState = { records: [], activeId: null, busy: false, error: null };
const listeners = new Set<() => void>();
let refreshing = false;
let sequence = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(patch: Partial<WorkspaceState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
}
export function useCrawlerWorkspace() { return useSyncExternalStore(subscribe, () => state); }
export function clearCrawlerError() { publish({ error: null }); }
export function selectCrawlerRecord(id: string) {
  if (state.records.some(record => record.id === id)) publish({ activeId: id, error: null });
}
export function setCrawlerSelection(id: string, ids: string[]) {
  publish({ records: state.records.map(record => {
    if (record.id !== id) return record;
    const valid = new Set(record.snapshot.entries.map(entry => entry.id));
    return { ...record, selected: [...new Set(ids)].filter(key => valid.has(key)) };
  }) });
}
function errorCode(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/^[a-z_]{1,80}$/.test(text)) return text.replace(/^remote_crawl_/, '');
  return 'operation_failed'; // Never display arbitrary native error strings or signed URLs.
}
function addRecord(record: CrawlRecord) {
  const records = [record, ...state.records.filter(row => row.id !== record.id)];
  // Never evict an active job: retain it even when users import several result sets.
  while (records.length > 8) {
    let index = -1;
    for (let i = records.length - 1; i >= 0; i--) {
      if (!isCrawlActive(records[i].snapshot.state)) {
        index = i;
        break;
      }
    }
    if (index <= 0) break;
    records.splice(index, 1);
  }
  publish({ records, activeId: record.id, error: null });
}
function applySnapshot(record: CrawlRecord, snapshot: CrawlSnapshot): CrawlRecord {
  const baseline = new Set(record.baselineUrls);
  const entries = snapshot.entries.filter(entry => !baseline.has(entry.url));
  const previous = new Set(record.snapshot.entries.map(entry => entry.id));
  const selected = new Set(record.selected);
  for (const entry of entries) if (!previous.has(entry.id)) selected.add(entry.id);
  const available = new Set(entries.map(entry => entry.id));
  return { ...record, snapshot: { ...snapshot, entries }, selected: [...selected].filter(id => available.has(id)) };
}

export async function startCrawl(request: CrawlRequest, name: string, baselineUrls: string[] = []): Promise<void> {
  if (state.busy) return;
  publish({ busy: true, error: null });
  try {
    const validated = validateCrawlRequest(request);
    if (state.records.some(row => isCrawlActive(row.snapshot.state))) throw new Error('busy');
    const snapshot = await invoke<CrawlSnapshot>('remote_crawl_start', { request: validated });
    const record: CrawlRecord = { id: snapshot.id, name: name.trim().slice(0, 100) || new URL(validated.seeds[0]).hostname,
      native: true, request: validated, snapshot: { ...snapshot, entries: [] }, selected: [], baselineUrls: baselineUrls.slice(0, 5000) };
    addRecord(applySnapshot(record, snapshot));
  } catch (error) { publish({ error: errorCode(error) }); }
  finally { publish({ busy: false }); }
}

export async function refreshCrawls(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    // Query only active native records; closing the modal never cancels native work.
    const active = state.records.filter(record => record.native && isCrawlActive(record.snapshot.state));
    for (const record of active) {
      const snapshot = await invoke<CrawlSnapshot>('remote_crawl_status', { id: record.id });
      publish({ records: state.records.map(row => row.id === record.id ? applySnapshot(row, snapshot) : row) });
    }
  } catch (error) { publish({ error: errorCode(error) }); }
  finally { refreshing = false; }
}

export async function controlCrawl(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
  try {
    await invoke('remote_crawl_control', { id, action });
    await refreshCrawls();
  } catch (error) { publish({ error: errorCode(error) }); }
}

export function addLinkBatch(name: string, entries: CrawlEntry[]): void {
  const id = `links-${Date.now()}-${++sequence}`;
  addRecord({ id, name: name.trim().slice(0, 100), native: false, selected: entries.map(entry => entry.id), baselineUrls: [],
    snapshot: { id, state: 'done', pagesVisited: 0, pagesQueued: 0, errors: 0, duplicates: 0, blocked: 0, entries } });
}
export function importCrawlerProject(text: string): void {
  try {
    const project = parseCrawlerProject(text);
    addLinkBatch(project.name, project.entries);
    if (project.request) publish({ records: state.records.map(record => record.id === state.activeId ? { ...record, request: project.request } : record) });
  } catch (error) { publish({ error: errorCode(error) }); }
}

/** A test seam for module state, not persisted application data. */
export function resetCrawlerWorkspaceForTests() {
  publish({ records: [], activeId: null, busy: false, error: null });
}
