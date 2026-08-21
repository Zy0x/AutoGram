import { describe, expect, it } from 'vitest';
import { basenamesAt, extractZipPasswordCandidates, isZipArchiveName, safeZipEntryPath } from './zipUtils';

describe('Drive ZIP workbench navigation', () => {
  const entries = [
    { name: 'docs/readme.md', size: 10 },
    { name: 'docs/data.json', size: 20 },
    { name: 'media/cover.jpg', size: 30 },
    { name: 'nested/archive.zip', size: 40, encrypted: true },
  ];

  it('builds virtual folders without explicit directory records', () => {
    expect(basenamesAt(entries, '', '', 'all').dirs).toEqual(['docs/', 'media/', 'nested/']);
    expect(basenamesAt(entries, 'docs/', '', 'doc').files.map((entry) => entry.name)).toEqual([
      'docs/data.json',
      'docs/readme.md',
    ]);
  });

  it('recognizes nested ZIP entries and strips traversal segments', () => {
    expect(isZipArchiveName('nested/ARCHIVE.ZIP')).toBe(true);
    expect(safeZipEntryPath('../../safe/../payload/file.txt')).toBe('safe/payload/file.txt');
  });

  it('extracts only explicitly labelled Telegram password candidates', () => {
    expect(extractZipPasswordCandidates(
      'Archive ready\nPassword: CentreHub2026\nmirror pass = 778899\nrandom unrelated words',
      'pack.zip'
    )).toEqual(['CentreHub2026', '778899']);
    expect(extractZipPasswordCandidates('This caption has no password label', 'pack.zip')).toEqual([]);
  });
});
