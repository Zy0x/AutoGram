import { describe, expect, it } from 'vitest';
import {
  CHAT_SOFT_PREFETCH_DELAY_MS,
  INITIAL_STATS_DELAY_MS,
  MIN_FOLDER_SCAN_DELAY_MS,
  progressiveSettleDelayMs,
  stagedInitialPageSize,
  stagedLoadMorePageSize,
} from './driveLoadStaging';

describe('drive session load staging', () => {
  it('gives constrained devices a longer settle window', () => {
    expect(progressiveSettleDelayMs('high')).toBe(0);
    expect(progressiveSettleDelayMs('mid')).toBe(40);
    expect(progressiveSettleDelayMs('low')).toBe(100);
  });

  it('fills the first viewport without overloading constrained devices', () => {
    expect(stagedInitialPageSize('high', 64)).toBe(64);
    expect(stagedInitialPageSize('high', 100)).toBe(80);
    expect(stagedInitialPageSize('mid', 32)).toBe(32);
    expect(stagedInitialPageSize('low', 16)).toBe(16);
    expect(stagedInitialPageSize('high', 8)).toBe(8);
  });

  it('caps incremental pages without enlarging a smaller configured page', () => {
    expect(stagedLoadMorePageSize('high', 140)).toBe(100);
    expect(stagedLoadMorePageSize('mid', 72)).toBe(64);
    expect(stagedLoadMorePageSize('low', 32)).toBe(32);
    expect(stagedLoadMorePageSize('high', 16)).toBe(16);
  });

  it('orders secondary and history-wide work after first paint', () => {
    expect(MIN_FOLDER_SCAN_DELAY_MS).toBeGreaterThan(progressiveSettleDelayMs('high'));
    expect(CHAT_SOFT_PREFETCH_DELAY_MS).toBeGreaterThan(MIN_FOLDER_SCAN_DELAY_MS);
    expect(INITIAL_STATS_DELAY_MS).toBeGreaterThan(CHAT_SOFT_PREFETCH_DELAY_MS);
  });
});
