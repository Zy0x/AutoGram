import { CRAWL_KINDS, DEFAULT_CRAWL_REQUEST, MAX_LINKS, type CrawlEntry, type CrawlKind, type CrawlRecord, type CrawlRequest } from './types';

/** Renderer validation is only an early guard; native transport checks DNS and redirects. */
export function canonicalCrawlUrl(raw: string): string {
  if (raw.length > 4096 || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error('invalid_url');
  let parsed: URL;
  try { parsed = new URL(raw.trim()); } catch { throw new Error('invalid_url'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('invalid_url');
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const parts = host.split('.').map(Number);
  const v4 = parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
  const privateV4 = v4 && (parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224
    || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127));
  const privateV6 = host.includes(':') && (host === '::' || host === '::1'
    || /^(fc|fd|fe[89ab]|ff)/.test(host) || host.startsWith('::ffff:'));
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || privateV4 || privateV6) throw new Error('private_url');
  parsed.hash = '';
  return parsed.href;
}

const EXTENSIONS: Partial<Record<CrawlKind, string[]>> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg', 'tif', 'tiff', 'heic'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv', 'ogv'],
  audio: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus'],
  document: ['pdf', 'txt', 'csv', 'json', 'xml', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz'],
  manifest: ['m3u8', 'm3u', 'mpd'],
  page: ['html', 'htm', 'php', 'aspx', 'asp', 'jsp'],
};
export function classifyCrawlUrl(url: string): CrawlKind {
  const ext = new URL(url).pathname.split('/').pop()?.split('.').slice(1).pop()?.toLowerCase();
  if (!ext) return 'page';
  for (const kind of CRAWL_KINDS) if (EXTENSIONS[kind]?.includes(ext)) return kind;
  return 'other';
}

export function safeCrawlFilename(raw: string, fallback = 'download.bin'): string {
  const clean = raw.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '').trim();
  const name = clean && clean !== '.' && clean !== '..' ? clean : fallback;
  const safe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
  // Native filenames have a UTF-8 byte limit, not a JS UTF-16 length limit.
  const dot = safe.lastIndexOf('.');
  const ext = dot > 0 && safe.length - dot <= 12 ? safe.slice(dot) : '';
  let stem = ext ? safe.slice(0, dot) : safe;
  while (new TextEncoder().encode(stem + ext).length > 180) stem = Array.from(stem).slice(0, -1).join('');
  return stem + ext;
}

export function entriesFromUrls(urls: string[]): CrawlEntry[] {
  if (urls.length > MAX_LINKS) throw new Error('too_many_links');
  const seen = new Set<string>();
  const entries: CrawlEntry[] = [];
  for (const raw of urls) {
    const url = canonicalCrawlUrl(raw);
    if (seen.has(url)) continue;
    seen.add(url);
    let name = new URL(url).pathname.split('/').pop() || 'download.bin';
    try { name = decodeURIComponent(name); } catch { /* Keep malformed escapes inert in filename. */ }
    entries.push({ id: `link-${entries.length}`, url, sourceUrl: url,
      filename: safeCrawlFilename(name), kind: classifyCrawlUrl(url), depth: 0 });
  }
  return entries;
}

export function parseLinkText(text: string): CrawlEntry[] {
  if (text.length > 4 * 1024 * 1024) throw new Error('import_too_large');
  const urls = text.match(/https?:\/\/[^\s<>"`]+/gi) || [];
  if (!urls.length) throw new Error('empty_links');
  return entriesFromUrls(urls);
}

/** Cartesian numeric ranges with preserved zero padding; bounded before expansion. */
export function generatePattern(pattern: string): CrawlEntry[] {
  if (pattern.length > 8192) throw new Error('invalid_pattern');
  const ranges = [...pattern.matchAll(/\[(\d+)-(\d+)\]/g)];
  if (!ranges.length || ranges.length > 6) throw new Error('invalid_pattern');
  let count = 1;
  for (const [, from, to] of ranges) {
    const a = Number(from), b = Number(to);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a > b || from.length > 10 || to.length > 10) throw new Error('invalid_pattern');
    count *= b - a + 1;
    if (count > MAX_LINKS) throw new Error('too_many_links');
  }
  let values = [''];
  let cursor = 0;
  for (const match of ranges) {
    const fixed = pattern.slice(cursor, match.index);
    const width = match[1].startsWith('0') || match[2].startsWith('0') ? Math.max(match[1].length, match[2].length) : 0;
    const next: string[] = [];
    for (const prefix of values) for (let n = Number(match[1]); n <= Number(match[2]); n++) {
      next.push(prefix + fixed + String(n).padStart(width, '0'));
    }
    values = next;
    cursor = match.index! + match[0].length;
  }
  return entriesFromUrls(values.map(value => value + pattern.slice(cursor)));
}

export function validateCrawlRequest(input: CrawlRequest): CrawlRequest {
  const limits = { maxDepth: [0, 8], maxPages: [1, 500], maxResults: [1, MAX_LINKS], delayMs: [250, 10000], concurrency: [1, 4] } as const;
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = input[key as keyof typeof limits];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('invalid_options');
  }
  if (!Array.isArray(input.seeds) || input.seeds.length < 1 || input.seeds.length > 32) throw new Error('invalid_seeds');
  if (!Array.isArray(input.kinds) || !input.kinds.length || input.kinds.some(k => !CRAWL_KINDS.includes(k))) throw new Error('invalid_options');
  for (const value of [input.includePattern, input.excludePattern, input.selector]) {
    if (typeof value !== 'string' || value.length > 500) throw new Error('invalid_options');
  }
  if (typeof input.sameOrigin !== 'boolean' || input.respectRobots !== true) throw new Error('invalid_options');
  const network = { ...DEFAULT_CRAWL_REQUEST.network!, ...(input.network || {}) };
  if (network.userAgent.length > 512 || network.timeoutSeconds < 5 || network.timeoutSeconds > 120
    || network.retries < 0 || network.retries > 5 || Object.keys(network.headers).length > 5) throw new Error('invalid_options');
  const rules = (input.rules || []).slice(0, 16);
  if (rules.length !== (input.rules || []).length || rules.some(rule => !rule.selector || !rule.attribute || !CRAWL_KINDS.includes(rule.kind))) throw new Error('invalid_options');
  return { ...input, network, rules, directoryMode: input.directoryMode === true, seeds: [...new Set(input.seeds.map(canonicalCrawlUrl))] };
}

export function exportCrawlerProject(record: CrawlRecord): string {
  return JSON.stringify({ format: 'autogram-crawl', version: 1, name: record.name,
    request: record.request, entries: record.snapshot.entries }, null, 2);
}

export function parseCrawlerProject(text: string): { name: string; entries: CrawlEntry[]; request?: CrawlRequest } {
  if (text.length > 4 * 1024 * 1024) throw new Error('import_too_large');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('invalid_project'); }
  if (!raw || typeof raw !== 'object') throw new Error('invalid_project');
  const project = raw as { format?: unknown; version?: unknown; name?: unknown; entries?: unknown; request?: CrawlRequest };
  if (project.format !== 'autogram-crawl' || project.version !== 1 || !Array.isArray(project.entries)
    || project.entries.length > MAX_LINKS || typeof project.name !== 'string') throw new Error('invalid_project');
  const seen = new Set<string>();
  const entries: CrawlEntry[] = [];
  for (const value of project.entries) {
    if (!value || typeof value !== 'object') throw new Error('invalid_project');
    const entry = value as CrawlEntry;
    if (typeof entry.url !== 'string' || typeof entry.sourceUrl !== 'string' || typeof entry.filename !== 'string'
      || !CRAWL_KINDS.includes(entry.kind)) throw new Error('invalid_project');
    const url = canonicalCrawlUrl(entry.url), sourceUrl = canonicalCrawlUrl(entry.sourceUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    // Imported type claims cannot turn an obvious playlist/page into a binary download.
    const inferred = classifyCrawlUrl(url);
    const kind = inferred === 'manifest' || inferred === 'page' ? inferred : entry.kind;
    entries.push({ id: `import-${entries.length}`, url, sourceUrl, filename: safeCrawlFilename(entry.filename),
      kind, depth: Number.isInteger(entry.depth) ? Math.max(0, Math.min(8, entry.depth)) : 0 });
  }
  return { name: project.name.slice(0, 100), entries,
    request: project.request ? validateCrawlRequest(project.request) : undefined };
}

/** Formula-safe quoted cells for exporting results to spreadsheet software. */
export function crawlerCsvCell(value: string): string {
  return `"${(/^[=+@\-\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
}
