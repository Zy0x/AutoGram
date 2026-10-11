import { describe, it, expect } from 'vitest';
import { extractImmediatePreviewThumbs } from './usePillPreviewThumbs';
import type { DriveFile } from '../../../lib/telegram/driveTypes';

function makeFile(id: number, thumbDataUrl?: string): DriveFile {
  return {
    id,
    folder_id: null,
    name: `photo_${id}.jpg`,
    size: 1024 * 300,
    icon_type: 'image',
    thumb_data_url: thumbDataUrl || null,
  };
}

describe('extractImmediatePreviewThumbs', () => {
  it('returns empty array when targetFiles is empty', () => {
    const result = extractImmediatePreviewThumbs([], null);
    expect(result).toEqual([]);
  });

  it('immediately extracts synchronous inline thumbnail data URLs (0ms instant)', () => {
    const files = [
      makeFile(10, 'data:image/jpeg;base64,inline_10'),
      makeFile(9, 'data:image/jpeg;base64,inline_9'),
      makeFile(8, 'data:image/jpeg;base64,inline_8'),
      makeFile(7, 'data:image/jpeg;base64,inline_7'),
    ];

    const result = extractImmediatePreviewThumbs(files, null);

    // Caps at top 3 items
    expect(result.length).toBe(3);
    expect(result[0].id).toBe(10);
    expect(result[0].url).toBe('data:image/jpeg;base64,inline_10');
    expect(result[1].id).toBe(9);
    expect(result[1].url).toBe('data:image/jpeg;base64,inline_9');
    expect(result[2].id).toBe(8);
    expect(result[2].url).toBe('data:image/jpeg;base64,inline_8');
  });

  it('handles files without thumbnail gracefully returning url: null', () => {
    const files = [makeFile(1), makeFile(2)];
    const result = extractImmediatePreviewThumbs(files, null);
    expect(result.length).toBe(2);
    expect(result[0].url).toBeNull();
    expect(result[1].url).toBeNull();
  });
});
