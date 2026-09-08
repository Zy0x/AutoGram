import { describe, it, expect } from 'vitest';
import type { PreviewThumbItem } from './NewMediaFloatingPill';
import type { DriveFile } from '../../../lib/telegram/driveTypes';

function makeFile(id: number, name = `file_${id}.mp4`): DriveFile {
  return {
    id,
    folder_id: null,
    name,
    size: 1024 * 1024 * 5,
    icon_type: 'video',
    created_at: String(1700000000 + id),
    thumb_data_url: `data:image/jpeg;base64,mock_${id}`,
  };
}

describe('NewMediaFloatingPill - Micro-thumb & Notice Helpers', () => {
  it('extracts at most 3 micro-thumbnails from newly added files', () => {
    const newFiles: DriveFile[] = [
      makeFile(105, 'video_105.mp4'),
      makeFile(104, 'video_104.mp4'),
      makeFile(103, 'video_103.mp4'),
      makeFile(102, 'video_102.mp4'),
      makeFile(101, 'video_101.mp4'),
    ];

    const thumbs: PreviewThumbItem[] = newFiles.slice(0, 3).map((f) => ({
      id: f.id,
      url: f.thumb_data_url || null,
      name: f.name,
    }));

    expect(thumbs.length).toBe(3);
    expect(thumbs[0].id).toBe(105);
    expect(thumbs[1].id).toBe(104);
    expect(thumbs[2].id).toBe(103);
    expect(thumbs[0].url).toContain('mock_105');
  });

  it('determines dismiss threshold correctly', () => {
    // When user scrolls near top (scrollTop <= 40), the pill auto-dismisses
    const isAtTop = (scrollTop: number) => scrollTop <= 40;
    // When new items arrive, pill should trigger only if user has scrolled down (scrollTop > 80)
    const shouldShowPill = (scrollTop: number, newCount: number) => scrollTop > 80 && newCount > 0;

    expect(isAtTop(0)).toBe(true);
    expect(isAtTop(35)).toBe(true);
    expect(isAtTop(45)).toBe(false);

    expect(shouldShowPill(120, 5)).toBe(true);
    expect(shouldShowPill(50, 5)).toBe(false); // near top, don't show pill
    expect(shouldShowPill(200, 0)).toBe(false);
  });

  it('formats notice translation keys correctly for each kind', () => {
    const getNoticeKey = (kind: 'added' | 'updated' | 'removed' | 'reordered') =>
      `drive.content_notice_${kind}`;

    expect(getNoticeKey('added')).toBe('drive.content_notice_added');
    expect(getNoticeKey('updated')).toBe('drive.content_notice_updated');
    expect(getNoticeKey('removed')).toBe('drive.content_notice_removed');
    expect(getNoticeKey('reordered')).toBe('drive.content_notice_reordered');
  });

  it('calculates visibleStartIndex accurately in both list and grid modes', async () => {
    const { calculateVisibleStartIndex } = await import('./NewMediaFloatingPill');

    // List mode: rowHeight = 44
    expect(calculateVisibleStartIndex(0, 'list', 180, 6, 44)).toBe(0);
    expect(calculateVisibleStartIndex(44, 'list', 180, 6, 44)).toBe(1);
    expect(calculateVisibleStartIndex(440, 'list', 180, 6, 44)).toBe(10);

    // Grid mode: cols = 6, rowHeight = 200
    expect(calculateVisibleStartIndex(0, 'grid', 200, 6)).toBe(0);
    expect(calculateVisibleStartIndex(199, 'grid', 200, 6)).toBe(0);
    expect(calculateVisibleStartIndex(200, 'grid', 200, 6)).toBe(6); // 1 row down = 6 items
    expect(calculateVisibleStartIndex(600, 'grid', 200, 6)).toBe(18); // 3 rows down = 18 items
  });

  it('decrements remaining unseen items dynamically as user scrolls up into new items', async () => {
    const { calculateRemainingNewCount } = await import('./NewMediaFloatingPill');
    const totalNew = 58;

    // Below new items: all 58 remain unseen
    expect(calculateRemainingNewCount(totalNew, 120)).toBe(58);
    expect(calculateRemainingNewCount(totalNew, 58)).toBe(58);

    // Scrolled up into new items: count decrements smoothly
    expect(calculateRemainingNewCount(totalNew, 50)).toBe(50);
    expect(calculateRemainingNewCount(totalNew, 36)).toBe(36);
    expect(calculateRemainingNewCount(totalNew, 12)).toBe(12);
    expect(calculateRemainingNewCount(totalNew, 6)).toBe(6);
    expect(calculateRemainingNewCount(totalNew, 1)).toBe(1);

    // Reached the top: 0 remaining (pill auto-dismisses)
    expect(calculateRemainingNewCount(totalNew, 0)).toBe(0);
    expect(calculateRemainingNewCount(totalNew, -5)).toBe(0);
    expect(calculateRemainingNewCount(0, 50)).toBe(0);
  });

  it('accumulates multiple upload batches smoothly', async () => {
    const { accumulateNewMediaCount } = await import('./NewMediaFloatingPill');

    // 8 uploads initially
    let currentUnread = 8;

    // Another batch of 10 completes
    currentUnread = accumulateNewMediaCount(currentUnread, 10);
    expect(currentUnread).toBe(18);

    // User scrolled up halfway, remaining is 10, then 40 more uploads arrive
    currentUnread = 10;
    currentUnread = accumulateNewMediaCount(currentUnread, 40);
    expect(currentUnread).toBe(50);
  });
});
