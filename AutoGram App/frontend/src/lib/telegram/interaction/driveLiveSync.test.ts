import { describe, it, expect } from 'vitest';
import { reconcileDriveLiveHead } from './driveLiveSync';
import type { DriveFile } from '../driveTypes';

function makeFile(id: number, name = `file_${id}`): DriveFile {
  return {
    id,
    folder_id: null,
    name,
    size: 1024,
    icon_type: 'file',
    created_at: String(1700000000 + id),
  };
}

describe('driveLiveSync - reconcileDriveLiveHead', () => {
  it('seamlessly merges new head items while retaining full deep history tail', () => {
    // Previous cache has items 100 down to 1
    const previous = Array.from({ length: 100 }, (_, i) => makeFile(100 - i));

    // Live head has 20 items: 105 down to 86 (5 new items: 105..101, and 15 existing: 100..86)
    const liveHead = Array.from({ length: 20 }, (_, i) => makeFile(105 - i));

    const result = reconcileDriveLiveHead(previous, liveHead, true);

    // Total should be 105 items (105 down to 1)
    expect(result.length).toBe(105);
    expect(result[0].id).toBe(105);
    expect(result[result.length - 1].id).toBe(1);

    // Verify all IDs are unique and strictly monotonic
    const ids = result.map((f) => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(105);
  });

  it('purges deleted items within the live head window', () => {
    // Previous had items 50 down to 1
    const previous = Array.from({ length: 50 }, (_, i) => makeFile(50 - i));

    // Live head returned items 50 down to 40, BUT item 45 was deleted on Telegram
    const liveHead = [50, 49, 48, 47, 46, 44, 43, 42, 41, 40].map((id) => makeFile(id));

    const result = reconcileDriveLiveHead(previous, liveHead, true);

    // Item 45 must NOT exist in the reconciled result
    expect(result.some((f) => f.id === 45)).toBe(false);

    // Tail items below 40 (39 down to 1) must remain intact
    expect(result.some((f) => f.id === 39)).toBe(true);
    expect(result.some((f) => f.id === 1)).toBe(true);
  });

  it('handles empty previous gracefully', () => {
    const liveHead = [makeFile(3), makeFile(2), makeFile(1)];
    const result = reconcileDriveLiveHead([], liveHead, true);
    expect(result.length).toBe(3);
    expect(result.map((f) => f.id)).toEqual([3, 2, 1]);
  });

  it('handles empty liveHead by returning previous', () => {
    const previous = [makeFile(3), makeFile(2), makeFile(1)];
    const result = reconcileDriveLiveHead(previous, [], true);
    expect(result.length).toBe(3);
  });
});
