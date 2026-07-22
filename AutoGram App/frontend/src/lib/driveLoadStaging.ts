import type { PerfTier } from './devicePerformance';

/** History-wide work starts only after the interactive surface is stable. */
export const INITIAL_STATS_DELAY_MS = 20_000;
export const CHAT_SOFT_PREFETCH_DELAY_MS = 15_000;
export const MIN_FOLDER_SCAN_DELAY_MS = 6_000;

export function progressiveSettleDelayMs(tier: PerfTier): number {
  // Visible cards already use a bounded thumbnail lane. Unlock near-viewport
  // prefetch almost instantly instead of leaving grid idle.
  return tier === 'high' ? 50 : tier === 'mid' ? 100 : 200;
}

/** First live metadata page: fast enough to fill the viewport, still bounded. */
export function stagedInitialPageSize(tier: PerfTier, configured: number): number {
  const cap = tier === 'high' ? 32 : tier === 'mid' ? 24 : 12;
  return Math.max(1, Math.min(configured, cap));
}

/**
 * Pagination remains incremental even when a legacy Turbo profile requests a
 * very large page. The cap protects React state, thumbnails, and Telethon from
 * one scroll producing a memory/network spike.
 */
export function stagedLoadMorePageSize(tier: PerfTier, configured: number): number {
  const cap = tier === 'high' ? 64 : tier === 'mid' ? 48 : 24;
  return Math.max(1, Math.min(configured, cap));
}
