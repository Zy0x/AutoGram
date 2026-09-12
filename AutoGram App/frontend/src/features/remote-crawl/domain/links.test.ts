import { describe, expect, it } from 'vitest';
import { canonicalCrawlUrl, crawlerCsvCell, entriesFromUrls, generatePattern, safeCrawlFilename } from './links';

describe('remote crawler link policies', () => {
  it('expands padded cartesian patterns within the hard cap', () => {
    const entries = generatePattern('https://example.com/f-[01-02]-[1-2].jpg');
    expect(entries.map(entry => entry.url)).toEqual([
      'https://example.com/f-01-1.jpg', 'https://example.com/f-01-2.jpg',
      'https://example.com/f-02-1.jpg', 'https://example.com/f-02-2.jpg',
    ]);
  });

  it('deduplicates URLs while preserving query identity', () => {
    const entries = entriesFromUrls(['https://example.com/a#one', 'https://example.com/a#two', 'https://example.com/a?x=1']);
    expect(entries.map(entry => entry.url)).toEqual(['https://example.com/a', 'https://example.com/a?x=1']);
  });

  it('rejects private targets and protects filenames and CSV formulas', () => {
    expect(() => canonicalCrawlUrl('http://127.0.0.1/x')).toThrow('private_url');
    expect(safeCrawlFilename('CON.mp4')).toBe('_CON.mp4');
    expect(crawlerCsvCell('=HYPERLINK("x")')).toContain("'=HYPERLINK");
  });
});
