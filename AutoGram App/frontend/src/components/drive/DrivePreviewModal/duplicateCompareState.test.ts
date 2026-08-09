import { describe, expect, it } from 'vitest';
import {
  chooseInitialDuplicateSlots,
  nextDistinctDuplicateIndex,
  shouldLoadSplitPreview,
} from './duplicateCompareState';

describe('duplicate split comparison state', () => {
  const files = [{ id: 10 }, { id: 20 }, { id: 30 }];

  it('keeps the smart candidate in A and never duplicates it in B', () => {
    expect(chooseInitialDuplicateSlots(files, 10, new Set([20, 30]))).toEqual({
      aIndex: 0,
      bIndex: 1,
      bEmpty: false,
    });
    expect(chooseInitialDuplicateSlots(files, 30, new Set([20]))).toEqual({
      aIndex: 0,
      bIndex: 2,
      bEmpty: false,
    });
  });

  it('leaves B empty when a group has only one item', () => {
    expect(chooseInitialDuplicateSlots([{ id: 10 }], 10, new Set())).toEqual({
      aIndex: 0,
      bIndex: 0,
      bEmpty: true,
    });
  });

  it('skips the file already shown by the other slot in both directions', () => {
    expect(nextDistinctDuplicateIndex(4, 0, 1, 1)).toBe(2);
    expect(nextDistinctDuplicateIndex(4, 3, 2, -1)).toBe(1);
    expect(nextDistinctDuplicateIndex(2, 0, 1, 1)).toBeNull();
  });

  it('does not load a split video until play is requested', () => {
    expect(shouldLoadSplitPreview('video', 'A', 'A', null)).toBe(false);
    expect(shouldLoadSplitPreview('video', 'A', 'A', 'A')).toBe(true);
  });

  it('allows only the selected playback slot to load video data', () => {
    expect(shouldLoadSplitPreview('video', 'A', 'A', 'B')).toBe(false);
    expect(shouldLoadSplitPreview('video', 'B', 'A', 'B')).toBe(true);
    expect(shouldLoadSplitPreview('image', 'A', 'A', 'B')).toBe(true);
  });
});
