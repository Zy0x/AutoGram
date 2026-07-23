import type { PerfTier } from './devicePerformance';

/** History-wide work starts only after the interactive surface is stable. */
export const INITIAL_STATS_DELAY_MS = 20_000;
export const CHAT_SOFT_PREFETCH_DELAY_MS = 15_000;
export const MIN_FOLDER_SCAN_DELAY_MS = 6_000;

export function progressiveSettleDelayMs(tier: PerfTier): number {
  // Unlock full thumb concurrency almost immediately (was leaving grid idle).
  return tier === 'high' ? 0 : tier === 'mid' ? 40 : 100;
}

/** First live metadata page: fast enough to fill the viewport, still bounded. */
export function stagedInitialPageSize(tier: PerfTier, configured: number): number {
  // Larger first page — thumbs ride along free with list_media stripped embeds.
  const cap = tier === 'high' ? 80 : tier === 'mid' ? 48 : 24;
  return Math.max(1, Math.min(configured, cap));
}

/**
 * Pagination remains incremental even when a legacy Turbo profile requests a
 * very large page. The cap protects React state, thumbnails, and Telethon from
 * one scroll producing a memory/network spike.
 */
export function stagedLoadMorePageSize(tier: PerfTier, configured: number): number {
  const cap = tier === 'high' ? 100 : tier === 'mid' ? 64 : 32;
  return Math.max(1, Math.min(configured, cap));
}
