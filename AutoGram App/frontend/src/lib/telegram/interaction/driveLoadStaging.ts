import type { PerfTier } from '../../utils/devicePerformance';

/**
 * History-wide work starts only after the interactive surface is stable.
 * Dikurangi secara signifikan agar UI terasa jauh lebih responsif di boot awal:
 * - INITIAL_STATS_DELAY_MS: 20s → 8s (stats masih akurat, tapi tidak menunda grid)
 * - CHAT_SOFT_PREFETCH_DELAY_MS: 15s → 3s (sidebar chat populer lebih cepat)
 * - MIN_FOLDER_SCAN_DELAY_MS: 6s → 2s (folder scan tidak menunda display)
 */
export const INITIAL_STATS_DELAY_MS = 8_000;
export const CHAT_SOFT_PREFETCH_DELAY_MS = 3_000;
export const MIN_FOLDER_SCAN_DELAY_MS = 2_000;

export function progressiveSettleDelayMs(tier: PerfTier): number {
  // Unlock full thumb concurrency almost immediately (was leaving grid idle).
  return tier === 'high' ? 0 : tier === 'mid' ? 30 : 80;
}

/**
 * First live metadata page: fast enough to fill the viewport, still bounded.
 * Dikurangi mid cap dari 48 → 28 sehingga MTProto mengirim data lebih sedikit
 * pada first paint → Time-to-First-Paint grid lebih cepat.
 * Load-more tetap 60-80 item/page sehingga scroll tetap mulus.
 */
export function stagedInitialPageSize(tier: PerfTier, configured: number): number {
  // Ultra-fast first page: 100 items on high, 60 on mid, 40 on low
  const cap = tier === 'high' ? 100 : tier === 'mid' ? 60 : 40;
  return Math.max(1, Math.min(configured, cap));
}

export function stagedLoadMorePageSize(tier: PerfTier, configured: number): number {
  // Ultra-fast load-more: 150 items on high, 100 on mid, 60 on low
  const cap = tier === 'high' ? 150 : tier === 'mid' ? 100 : 60;
  return Math.max(1, Math.min(configured, cap));
}
