/**
 * Adaptive Multi-Tier Telegram Metadata Indexing Engine
 * Tiers:
 *  - Micro (< 1,500 items): Hyper-Speed Direct Burst (10-20ms)
 *  - Medium (1,500 - 15,000 items): Adaptive Turbo Stream (30-45ms)
 *  - Massive (15,000 - 100,000 items like #Gudang): 2-Phase Viewport Pipeline (Phase 1: 25ms, Phase 2: 60ms)
 *  - Colossal (100,000 - 500,000 items): Direct SQLite Stream + Micro-Breath Pauses (200ms/5k items)
 *  - Galactic (> 500,000 items): Server-Side B-Tree Query + Background Pipe
 */

export type IndexingTier = 'micro' | 'medium' | 'massive' | 'colossal' | 'galactic';

export interface IndexingMetrics {
  percent: number;
  speedMsgPerSec: number;
  etaSeconds: number | null;
  etaFormatted: string | null;
}

export interface AdaptiveDelayResult {
  delayMs: number;
  isMicroBreath: boolean;
}

/**
 * Automatically determine the scale tier from total item count or current loaded count.
 */
export function determineIndexingTier(totalCount: number | null | undefined, loadedCount: number): IndexingTier {
  const count = (totalCount && totalCount > 0) ? totalCount : loadedCount;
  if (count <= 1500) return 'micro';
  if (count <= 15000) return 'medium';
  if (count <= 100000) return 'massive';
  if (count <= 500000) return 'colossal';
  return 'galactic';
}

/**
 * Calculate adaptive delay based on tier, loaded count, and network latency.
 */
export function getAdaptiveDelay(
  tier: IndexingTier,
  loadedCount: number,
  networkLatencyMs: number = 0
): AdaptiveDelayResult {
  let baseDelay = 35;
  let isMicroBreath = false;

  switch (tier) {
    case 'micro':
      baseDelay = 15;
      break;
    case 'medium':
      baseDelay = 30;
      break;
    case 'massive':
      // Phase 1 (first 2,000 files): Fast viewport fill
      // Phase 2: Sustained background pacing with anti-flood protection
      baseDelay = loadedCount < 2000 ? 25 : 60;
      break;
    case 'colossal':
    case 'galactic':
      baseDelay = 50;
      // Micro-breath pause every 5,000 items to relax Telegram socket connection
      if (loadedCount > 0 && loadedCount % 5000 < 200) {
        baseDelay = 200;
        isMicroBreath = true;
      }
      break;
  }

  // Latency compensation: if network latency is high (>350ms), backoff by 40%
  if (networkLatencyMs > 350) {
    baseDelay = Math.round(baseDelay * 1.4);
  }

  return { delayMs: Math.max(10, baseDelay), isMicroBreath };
}

/**
 * Format ETA in human-readable compact string (e.g. "12s", "1m 30s").
 */
export function formatEta(etaSeconds: number | null): string | null {
  if (etaSeconds == null || !Number.isFinite(etaSeconds) || etaSeconds <= 0) return null;
  const rounded = Math.round(etaSeconds);
  if (rounded < 60) {
    return `${rounded}s`;
  }
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * Calculate real-time indexing metrics (percentage, speed in msg/sec, ETA).
 */
export function calculateIndexingMetrics(
  processed: number,
  total: number | null | undefined,
  startTimeMs: number,
  nowMs: number = Date.now()
): IndexingMetrics {
  const percent = (total && total > 0)
    ? Math.min(100, Math.max(0, Math.round((processed / total) * 100)))
    : 0;

  const elapsedSec = Math.max(0.1, (nowMs - startTimeMs) / 1000);
  const speedMsgPerSec = Math.round(processed / elapsedSec);

  let etaSeconds: number | null = null;
  if (total && total > processed && speedMsgPerSec > 0) {
    etaSeconds = (total - processed) / speedMsgPerSec;
  }

  return {
    percent,
    speedMsgPerSec,
    etaSeconds,
    etaFormatted: formatEta(etaSeconds),
  };
}
