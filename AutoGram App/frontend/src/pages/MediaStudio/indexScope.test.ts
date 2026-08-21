import { describe, expect, it } from 'vitest';
import {
  completedIndexNeedsRevalidation,
  isIndexEventForActiveScope,
  partialIndexNeedsAutoResume,
} from './indexScope';

describe('media index UI scope isolation', () => {
  it('accepts only the active peer and rejects topic-ambiguous legacy events', () => {
    expect(isIndexEventForActiveScope(-1001, -1001, null)).toBe(true);
    expect(isIndexEventForActiveScope(-1001, -1002, null)).toBe(false);
    expect(isIndexEventForActiveScope(-1001, -1001, 42)).toBe(false);
    expect(isIndexEventForActiveScope(0, null, null)).toBe(true);
  });

  it('invalidates a stale completed checkpoint without treating partial work as corrupt', () => {
    expect(completedIndexNeedsRevalidation(true, 1670, 4767)).toBe(true);
    expect(completedIndexNeedsRevalidation(true, 4767, 4767)).toBe(false);
    expect(completedIndexNeedsRevalidation(false, 1670, 4767)).toBe(false);
    expect(completedIndexNeedsRevalidation(true, 0, 0)).toBe(false);
    expect(completedIndexNeedsRevalidation(true, 10, null)).toBe(false);
  });

  it('auto-resumes a partial durable index even when an old build left no checkpoint', () => {
    expect(partialIndexNeedsAutoResume(false, 1726, 57055)).toBe(true);
    expect(partialIndexNeedsAutoResume(false, 0, 57055)).toBe(true);
    expect(partialIndexNeedsAutoResume(false, 57055, 57055)).toBe(false);
    expect(partialIndexNeedsAutoResume(true, 1726, 57055)).toBe(false);
    expect(partialIndexNeedsAutoResume(false, 10, null)).toBe(false);
  });
});
