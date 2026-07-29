import { describe, expect, it } from 'vitest';
import {
  clampMediaBytes,
  clampMediaTotal,
  loadedMediaBytes,
  loadedUniqueMediaCount,
} from './driveMediaTotals';

describe('drive media totals', () => {
  it('never lets a stale counter shrink below loaded unique cards', () => {
    const files = [{ id: 1 }, { id: 2 }, { id: 2 }, { id: 3 }];
    expect(loadedUniqueMediaCount(files)).toBe(3);
    expect(clampMediaTotal(2, files)).toBe(3);
    expect(clampMediaTotal(9, files)).toBe(9);
  });

  it('uses loaded cards as a lower bound when a counter is unavailable', () => {
    expect(clampMediaTotal(null, [{ id: 7 }])).toBe(1);
    expect(clampMediaTotal(null, [])).toBeNull();
  });

  it('deduplicates loaded byte lower bounds by message id', () => {
    const files = [{ id: 1, size: 100 }, { id: 1, size: 100 }, { id: 2, size: 250 }];
    expect(loadedMediaBytes(files)).toBe(350);
    expect(clampMediaBytes(200, files)).toBe(350);
    expect(clampMediaBytes(500, files)).toBe(500);
  });
});
