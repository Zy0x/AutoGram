export const CRAWL_KINDS = ['image', 'video', 'audio', 'document', 'archive', 'other', 'page', 'manifest'] as const;
export type CrawlKind = typeof CRAWL_KINDS[number];
export interface CrawlRequest {
  seeds: string[];
  maxDepth: number;
  maxPages: number;
  maxResults: number;
  delayMs: number;
  concurrency: number;
  sameOrigin: boolean;
  respectRobots: boolean;
  includePattern: string;
  excludePattern: string;
  selector: string;
  kinds: CrawlKind[];
}
export interface CrawlEntry {
  id: string;
  url: string;
  sourceUrl: string;
  filename: string;
  kind: CrawlKind;
  depth: number;
}
export type CrawlState = 'running' | 'paused' | 'done' | 'cancelled' | 'failed' | 'limited';
export interface CrawlSnapshot {
  id: string;
  state: CrawlState;
  pagesVisited: number;
  pagesQueued: number;
  errors: number;
  duplicates: number;
  blocked: number;
  entries: CrawlEntry[];
  error?: string | null;
}
export interface CrawlRecord {
  id: string;
  name: string;
  native: boolean;
  request?: CrawlRequest;
  snapshot: CrawlSnapshot;
  selected: string[];
  baselineUrls: string[];
}
export const DEFAULT_CRAWL_REQUEST: CrawlRequest = {
  seeds: [], maxDepth: 2, maxPages: 100, maxResults: 1000, delayMs: 500,
  concurrency: 2, sameOrigin: true, respectRobots: true,
  includePattern: '', excludePattern: '', selector: '',
  kinds: ['image', 'video', 'audio', 'document', 'archive', 'manifest'],
};
export const MAX_LINKS = 5000;
export const isCrawlActive = (state: CrawlState) => state === 'running' || state === 'paused';
