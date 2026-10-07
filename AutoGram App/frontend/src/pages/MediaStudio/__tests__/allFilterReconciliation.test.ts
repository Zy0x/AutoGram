import { describe, expect, it } from 'vitest';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import {
  mergeAllFilterContentFiles,
  mergeReconciledFilesIntoAllState,
  shouldPrefetchFilesLaneForAllFilter,
} from '../allFilterReconciliation';

function makeFile(id: number, overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id,
    folder_id: -1003214112048,
    name: `item_${id}.jpg`,
    size: 1024,
    mime_type: 'image/jpeg',
    icon_type: 'image',
    has_thumb: true,
    as_document: false,
    telegram_category: 'media',
    ...overrides,
  };
}

describe('allFilterReconciliation', () => {
  it('merges Files (Document) and GIFs lanes into All filter in descending ID order', () => {
    const baseFiles = [makeFile(52391), makeFile(52390), makeFile(52388)];
    const doc52397 = makeFile(52397, {
      name: '20260510_060956.jpg',
      as_document: true,
      icon_type: 'document',
      telegram_category: 'file',
      telegram_subtype: 'doc_photo',
      topic_id: 15415,
    });
    const doc52396 = makeFile(52396, {
      name: '20250721_235055.jpg',
      as_document: true,
      icon_type: 'document',
      telegram_category: 'file',
      telegram_subtype: 'doc_photo',
      topic_id: 15415,
    });
    const gif52389 = makeFile(52389, {
      name: 'anim.mp4',
      as_document: false,
      icon_type: 'gif',
      telegram_category: 'gif',
    });

    const merged = mergeAllFilterContentFiles(baseFiles, {
      files: [doc52397, doc52396],
      gifs: [gif52389],
    });

    expect(merged.map((f) => f.id)).toEqual([52397, 52396, 52391, 52390, 52389, 52388]);
    expect(merged[0].name).toBe('20260510_060956.jpg');
    expect(merged[0].telegram_category).toBe('file');
  });

  it('returns original baseFiles reference when no new items exist in filteredFilesMap', () => {
    const baseFiles = [makeFile(52397), makeFile(52391)];
    const merged = mergeAllFilterContentFiles(baseFiles, {
      files: [makeFile(52397)],
    });
    expect(merged).toBe(baseFiles);
  });

  it('mergeReconciledFilesIntoAllState deduplicates and sorts descending', () => {
    const prev = [makeFile(52391), makeFile(52390)];
    const incoming = [makeFile(52397, { as_document: true, telegram_category: 'file' }), makeFile(52391)];
    const res = mergeReconciledFilesIntoAllState(prev, incoming);
    expect(res.map((f) => f.id)).toEqual([52397, 52391, 52390]);
  });

  it('shouldPrefetchFilesLaneForAllFilter detects when All base lacks document items', () => {
    const mediaOnly = [makeFile(52391), makeFile(52390)];
    expect(shouldPrefetchFilesLaneForAllFilter(mediaOnly, {}, 163)).toBe(true);
    expect(shouldPrefetchFilesLaneForAllFilter(mediaOnly, {}, null)).toBe(true);
    expect(shouldPrefetchFilesLaneForAllFilter(mediaOnly, {}, 0)).toBe(false);
    expect(
      shouldPrefetchFilesLaneForAllFilter(
        mediaOnly,
        { files: [makeFile(52397, { as_document: true, telegram_category: 'file' })] },
        163
      )
    ).toBe(false);
  });
});
