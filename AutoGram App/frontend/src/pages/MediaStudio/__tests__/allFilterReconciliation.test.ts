import { describe, expect, it } from 'vitest';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import {
  applyMutationsToFilteredFilesMap,
  getAuxiliaryLanesToPrefetchForAllFilter,
  mergeAllFilterContentFiles,
  mergeReconciledFilesIntoAllState,
  removeDeletedIdsFromFilteredFilesMap,
  resolveActiveFilterContentFiles,
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
  it('merges Files (Document), GIFs, Audio, and Links lanes into All filter in descending ID order', () => {
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
    const audio52394 = makeFile(52394, {
      name: 'track.mp3',
      mime_type: 'audio/mpeg',
      icon_type: 'audio',
      as_document: false,
      telegram_category: 'audio',
    });
    const link52392 = makeFile(52392, {
      name: 'https://example.com',
      mime_type: 'text/x-uri',
      icon_type: 'web',
      as_document: false,
      telegram_category: 'link',
    });
    const gif52389 = makeFile(52389, {
      name: 'anim.mp4',
      as_document: false,
      icon_type: 'gif',
      telegram_category: 'gif',
    });
    const sticker52399 = makeFile(52399, {
      name: 'sticker.webp',
      mime_type: 'image/webp',
      icon_type: 'sticker',
      telegram_category: 'sticker',
    });

    const merged = mergeAllFilterContentFiles(baseFiles, {
      files: [doc52397, doc52396],
      audio: [audio52394],
      links: [link52392],
      gifs: [gif52389],
      stickers: [sticker52399],
    });

    expect(merged.map((f) => f.id)).toEqual([
      52397,
      52396,
      52394,
      52392,
      52391,
      52390,
      52389,
      52388,
    ]);
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

  it('getAuxiliaryLanesToPrefetchForAllFilter returns missing lanes for All and Media filters', () => {
    const mediaOnly = [makeFile(52391), makeFile(52390)];
    expect(
      getAuxiliaryLanesToPrefetchForAllFilter('all', mediaOnly, {}, {
        gifCount: 3,
        fileCount: 163,
        audioCount: 2,
        linkCount: 5,
      })
    ).toEqual(['gifs', 'files', 'audio', 'links']);

    expect(
      getAuxiliaryLanesToPrefetchForAllFilter('media', mediaOnly, {}, {
        gifCount: 3,
        fileCount: 163,
        audioCount: 2,
        linkCount: 5,
      })
    ).toEqual(['gifs']);

    expect(
      getAuxiliaryLanesToPrefetchForAllFilter('all', mediaOnly, {}, {
        gifCount: 0,
        fileCount: 10,
        audioCount: 0,
        linkCount: 0,
      })
    ).toEqual(['files']);
  });

  it('resolveActiveFilterContentFiles bidirectionally merges Drive and Telegram category filters', () => {
    const photoInBase = makeFile(52391, {
      name: 'photo.jpg',
      mime_type: 'image/jpeg',
      icon_type: 'image',
      as_document: false,
      telegram_category: 'media',
    });
    const docPhotoInFilesLane = makeFile(52397, {
      name: '20260510_060956.jpg',
      mime_type: 'image/jpeg',
      icon_type: 'image',
      as_document: true,
      telegram_category: 'file',
      telegram_subtype: 'doc_photo',
    });
    const zipInFilesLane = makeFile(52395, {
      name: 'bundle.zip',
      mime_type: 'application/zip',
      icon_type: 'archive',
      as_document: true,
      telegram_category: 'file',
      telegram_subtype: 'doc_archive',
    });

    const filteredMap = {
      files: [docPhotoInFilesLane, zipInFilesLane],
    };

    // Drive perspective 'images' should include both photoInBase AND docPhotoInFilesLane!
    const driveImages = resolveActiveFilterContentFiles(
      'images',
      'drive',
      [photoInBase],
      filteredMap
    );
    expect(driveImages.map((f) => f.id)).toEqual([52397, 52391]);

    // Drive perspective 'archives' should include zipInFilesLane!
    const driveArchives = resolveActiveFilterContentFiles(
      'archives',
      'drive',
      [photoInBase],
      filteredMap
    );
    expect(driveArchives.map((f) => f.id)).toEqual([52395]);

    // Telegram perspective 'files' should include both docPhotoInFilesLane and zipInFilesLane
    const tgFiles = resolveActiveFilterContentFiles(
      'files',
      'telegram',
      [photoInBase],
      filteredMap
    );
    expect(tgFiles.map((f) => f.id)).toEqual([52397, 52395]);
  });

  it('removeDeletedIdsFromFilteredFilesMap purges deleted IDs from all category lanes to prevent ghost resurrection', () => {
    const doc52397 = makeFile(52397, { as_document: true, telegram_category: 'file' });
    const doc52396 = makeFile(52396, { as_document: true, telegram_category: 'file' });
    const gif52389 = makeFile(52389, { icon_type: 'gif', telegram_category: 'gif' });

    const initialMap = {
      files: [doc52397, doc52396],
      gifs: [gif52389],
      images: [doc52397],
    };

    const purged = removeDeletedIdsFromFilteredFilesMap(initialMap, [52397]);
    expect(purged.files.map((f) => f.id)).toEqual([52396]);
    expect(purged.images.map((f) => f.id)).toEqual([]);
    expect(purged.gifs).toBe(initialMap.gifs);

    // Ensure mergeAllFilterContentFiles no longer resurrects 52397
    const mergedAfterDelete = mergeAllFilterContentFiles([doc52396], purged);
    expect(mergedAfterDelete.map((f) => f.id)).toEqual([52396, 52389]);
  });

  it('applyMutationsToFilteredFilesMap syncs live upserts and deletes into populated category lanes', () => {
    const doc52396 = makeFile(52396, {
      name: 'old.pdf',
      mime_type: 'application/pdf',
      icon_type: 'document',
      as_document: true,
      telegram_category: 'file',
      topic_id: 15415,
    });
    const newDoc52398 = makeFile(52398, {
      name: 'new_photo_as_file.jpg',
      mime_type: 'image/jpeg',
      icon_type: 'image',
      as_document: true,
      telegram_category: 'file',
      topic_id: 15415,
    });

    const initialMap = {
      files: [doc52396],
      images: [makeFile(52391, { topic_id: 15415 })],
    };

    const updated = applyMutationsToFilteredFilesMap(
      initialMap,
      [
        { action: 'upsert', row: newDoc52398 },
        { action: 'delete', message_ids: [52396] },
      ],
      15415
    );

    expect(updated.files.map((f) => f.id)).toEqual([52398]);
    expect(updated.images.map((f) => f.id)).toEqual([52398, 52391]);
  });
});
