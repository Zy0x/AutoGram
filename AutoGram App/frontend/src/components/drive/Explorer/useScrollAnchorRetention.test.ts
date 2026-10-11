import { describe, it, expect } from 'vitest';
import { calculateScrollAnchorAdjustment } from './useScrollAnchorRetention';
import type { DriveFile } from '../../../lib/telegram/driveTypes';

function makeFile(id: number, name = `file_${id}.jpg`): DriveFile {
  return {
    id,
    folder_id: null,
    name,
    size: 1024 * 500,
    icon_type: 'image',
    created_at: String(1700000000 + id),
  };
}

describe('calculateScrollAnchorAdjustment', () => {
  it('does not shift scroll when user is near the top (scrollTop <= 80)', () => {
    const initialFiles = [makeFile(10), makeFile(9), makeFile(8), makeFile(7)];
    const updatedFiles = [makeFile(12), makeFile(11), ...initialFiles];

    const result = calculateScrollAnchorAdjustment({
      scrollTop: 50,
      previous: initialFiles,
      displayed: updatedFiles,
      viewMode: 'grid',
      cols: 4,
      rowHeight: 200,
    });

    expect(result.targetScrollTop).toBe(50);
    expect(result.shiftPx).toBe(0);
    expect(result.newAbove).toBe(0);
  });

  it('keeps the user visible item anchored at exact pixel position in grid mode when 1 item is prepended (shifts 0 rows)', () => {
    // 16 items initially (indices 0..15 across 4 rows)
    const initialFiles = Array.from({ length: 16 }, (_, i) => makeFile(100 - i));

    // User is viewing row 2 (items index 8..11), row offset is 400px, scrollTop is 420px (offset 20px inside row)
    // 1 new item prepended at index 0.
    // Previous anchor was item at index 8 (file 92).
    // Now file 92 moves to index 9.
    // In a 4-col grid, Math.floor(9 / 4) === 2 === Math.floor(8 / 4).
    // The row DID NOT CHANGE! targetScrollTop remains 420px.
    const updatedFiles = [makeFile(101), ...initialFiles];

    const result = calculateScrollAnchorAdjustment({
      scrollTop: 420,
      previous: initialFiles,
      displayed: updatedFiles,
      viewMode: 'grid',
      cols: 4,
      rowHeight: 200,
    });

    expect(result.targetScrollTop).toBe(420);
    expect(result.shiftPx).toBe(0);
    expect(result.newAbove).toBe(1);
  });

  it('adjusts scroll by exactly 1 row (200px) when 4 items are prepended in a 4-col grid', () => {
    const initialFiles = Array.from({ length: 16 }, (_, i) => makeFile(100 - i));

    // User viewing row 2 at scrollTop = 420px
    // Prepend 4 items. File 92 (previously at index 8, row 2) moves to index 12, row 3.
    // targetScrollTop = (3 * 200) + 20 = 620px (shift of exactly +200px).
    const prepended = [makeFile(104), makeFile(103), makeFile(102), makeFile(101)];
    const updatedFiles = [...prepended, ...initialFiles];

    const result = calculateScrollAnchorAdjustment({
      scrollTop: 420,
      previous: initialFiles,
      displayed: updatedFiles,
      viewMode: 'grid',
      cols: 4,
      rowHeight: 200,
    });

    expect(result.targetScrollTop).toBe(620);
    expect(result.shiftPx).toBe(200);
    expect(result.newAbove).toBe(4);
  });

  it('adjusts scroll in list mode by item height (48px) per prepended item', () => {
    const initialFiles = Array.from({ length: 10 }, (_, i) => makeFile(50 - i));

    // User viewing item 5 (index 5) at scrollTop = 250px (5 * 48 + 10)
    // Prepend 2 items. Anchor item moves from index 5 to index 7.
    // targetScrollTop = (7 * 48) + 10 = 346px (shift of 2 * 48 = 96px).
    const updatedFiles = [makeFile(52), makeFile(51), ...initialFiles];

    const result = calculateScrollAnchorAdjustment({
      scrollTop: 250,
      previous: initialFiles,
      displayed: updatedFiles,
      viewMode: 'list',
      cols: 1,
      rowHeight: 200,
      listRowHeight: 48,
    });

    expect(result.targetScrollTop).toBe(346);
    expect(result.shiftPx).toBe(96);
    expect(result.newAbove).toBe(2);
  });
});
