import { describe, expect, it } from 'vitest';
import { shouldPreservePersistentRows } from './persistentIndexPolicy';

describe('shouldPreservePersistentRows', () => {
  it('keeps a durable index for an ambiguous empty remote page', () => {
    expect(shouldPreservePersistentRows({
      persistentRowCount: 48,
      remoteRowCount: 0,
      remoteTotalCount: null,
      remoteStatsAccurate: false,
    })).toBe(true);
  });

  it('accepts an authoritative exact zero for real Telegram deletions', () => {
    expect(shouldPreservePersistentRows({
      persistentRowCount: 48,
      remoteRowCount: 0,
      remoteTotalCount: 0,
      remoteStatsAccurate: true,
    })).toBe(false);
  });

  it('never masks a non-empty live response', () => {
    expect(shouldPreservePersistentRows({
      persistentRowCount: 48,
      remoteRowCount: 1,
      remoteTotalCount: 1,
      remoteStatsAccurate: true,
    })).toBe(false);
  });
});
