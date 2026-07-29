import { describe, expect, it } from 'vitest';
import {
  applyBulkRenamePattern,
  computeSpaceUsage,
  createNavHistory,
  filterSkipDuplicates,
  findDuplicateGroups,
  matchesAdvFilter,
  navBack,
  navForward,
  navPush,
  truncateMiddle,
} from './drivePower';
import type { DriveFile } from './driveTypes';

function f(partial: Partial<DriveFile> & { id: number; name: string }): DriveFile {
  return {
    folder_id: null,
    size: 100,
    icon_type: 'document',
    ...partial,
  };
}

describe('drivePower duplicates', () => {
  it('groups by name+size', () => {
    const files = [
      f({ id: 1, name: 'a.jpg', size: 10 }),
      f({ id: 2, name: 'a.jpg', size: 10 }),
      f({ id: 3, name: 'b.jpg', size: 10 }),
    ];
    const g = findDuplicateGroups(files, 'name_size');
    expect(g).toHaveLength(1);
    expect(g[0].files).toHaveLength(2);
  });
});

describe('drivePower bulk rename', () => {
  it('applies pattern tokens', () => {
    const files = [f({ id: 1, name: 'photo.jpg', file_ext: 'jpg' }), f({ id: 2, name: 'x.png', file_ext: 'png' })];
    const r = applyBulkRenamePattern(files, 'IMG_{n:3}.{ext}', 1);
    expect(r[0].newName).toBe('IMG_001.jpg');
    expect(r[1].newName).toBe('IMG_002.png');
  });
});

describe('drivePower space', () => {
  it('sums bytes', () => {
    const u = computeSpaceUsage([f({ id: 1, name: 'a', size: 100, icon_type: 'image' }), f({ id: 2, name: 'b', size: 50, icon_type: 'video' })]);
    expect(u.totalBytes).toBe(150);
    expect(u.fileCount).toBe(2);
  });
});

describe('drivePower skip dup', () => {
  it('skips matching name+size', () => {
    const src = [f({ id: 1, name: 'a.pdf', size: 9 }), f({ id: 2, name: 'b.pdf', size: 1 })];
    const dest = [f({ id: 99, name: 'a.pdf', size: 9 })];
    const { toCopy, skipped } = filterSkipDuplicates(src, dest);
    expect(toCopy.map((x) => x.id)).toEqual([2]);
    expect(skipped.map((x) => x.id)).toEqual([1]);
  });
});

describe('drivePower nav', () => {
  it('back/forward', () => {
    let h = createNavHistory({ kind: 'saved', id: null });
    h = navPush(h, { kind: 'chat', id: 1 });
    h = navPush(h, { kind: 'drive', id: 2 });
    const back = navBack(h)!;
    expect(back.stack[back.index].id).toBe(1);
    const fwd = navForward(back)!;
    expect(fwd.stack[fwd.index].id).toBe(2);
  });
});

describe('drivePower adv filter + truncate', () => {
  it('filters size', () => {
    expect(matchesAdvFilter(f({ id: 1, name: 'a', size: 50 }), { sizeMin: 100 })).toBe(false);
    expect(matchesAdvFilter(f({ id: 1, name: 'a', size: 150 }), { sizeMin: 100 })).toBe(true);
  });
  it('truncates middle', () => {
    expect(truncateMiddle('History Morphe Long Name', 14).includes('…')).toBe(true);
  });
});
