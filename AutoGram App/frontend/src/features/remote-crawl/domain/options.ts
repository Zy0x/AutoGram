import { CRAWL_KINDS, DEFAULT_CRAWL_REQUEST, type CrawlExtractionRule, type CrawlNetworkOptions } from './types';

const HEADER_NAMES = new Set(['accept', 'accept-language', 'referer', 'origin', 'cache-control']);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const ascii = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && !/[^\x20-\x7e]/.test(value);

export function normalizeNetwork(value: unknown): CrawlNetworkOptions {
  if (value !== undefined && !object(value)) throw new Error('invalid_network');
  const raw = { ...DEFAULT_CRAWL_REQUEST.network!, ...value as Partial<CrawlNetworkOptions> };
  if (!ascii(raw.userAgent, 512) || !raw.userAgent.trim() || !Number.isInteger(raw.timeoutSeconds)
    || raw.timeoutSeconds < 5 || raw.timeoutSeconds > 120 || !Number.isInteger(raw.retries)
    || raw.retries < 0 || raw.retries > 5 || !ascii(raw.proxyUrl, 4096)) throw new Error('invalid_network');
  if (!object(raw.headers) || Object.keys(raw.headers).length > 5) throw new Error('invalid_headers');
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(raw.headers)) {
    const key = name.toLowerCase();
    if (!HEADER_NAMES.has(key) || Object.prototype.hasOwnProperty.call(headers, key) || !ascii(header, 2048)) throw new Error('invalid_headers');
    if (key === 'referer' || key === 'origin') {
      let url: URL;
      try { url = new URL(header); } catch { throw new Error('invalid_headers'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid_headers');
    }
    headers[key] = header;
  }
  if (raw.proxyUrl) {
    let url: URL;
    try { url = new URL(raw.proxyUrl); } catch { throw new Error('invalid_proxy'); }
    if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.hash || url.search) {
      throw new Error('invalid_proxy');
    }
  }
  return { userAgent: raw.userAgent, proxyUrl: raw.proxyUrl, timeoutSeconds: raw.timeoutSeconds, retries: raw.retries, headers };
}

export function normalizeRules(value: unknown): CrawlExtractionRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new Error('invalid_rules');
  return value.map(rule => {
    if (!object(rule) || Object.keys(rule).some(key => !['selector', 'attribute', 'kind', 'follow'].includes(key))
      || typeof rule.selector !== 'string' || !rule.selector.trim() || new TextEncoder().encode(rule.selector).length > 500
      || typeof rule.attribute !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(rule.attribute)
      || typeof rule.kind !== 'string' || !CRAWL_KINDS.includes(rule.kind as CrawlExtractionRule['kind'])
      || (rule.follow !== undefined && typeof rule.follow !== 'boolean') || (rule.follow && rule.kind !== 'page')) {
      throw new Error('invalid_rules');
    }
    return { selector: rule.selector, attribute: rule.attribute, kind: rule.kind as CrawlExtractionRule['kind'], follow: rule.follow === true };
  });
}

export function parseRuleText(text: string): CrawlExtractionRule[] {
  if (!text.trim()) return [];
  if (text.length > 12000) throw new Error('invalid_rules');
  try { return normalizeRules(JSON.parse(text)); } catch { throw new Error('invalid_rules'); }
}

export function parseHeaderText(text: string): Record<string, string> {
  if (!text.trim()) return {};
  if (text.length > 12000) throw new Error('invalid_headers');
  try { return normalizeNetwork({ headers: JSON.parse(text) }).headers; } catch { throw new Error('invalid_headers'); }
}
