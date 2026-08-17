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
 * Pacing targets ~1,800 - 2,200 msgs/sec in healthy conditions while auto-throttling
 * if network latency rises to protect MTProto sockets from flood limits.
 */
export function getAdaptiveDelay(
  tier: IndexingTier,
  loadedCount: number,
  networkLatencyMs: number = 0
): AdaptiveDelayResult {
  let baseDelay = 20;
  let isMicroBreath = false;

  switch (tier) {
    case 'micro':
      baseDelay = 10;
      break;
    case 'medium':
      baseDelay = 15;
      break;
    case 'massive':
      // Phase 1 (first 2,000 files): Fast viewport burst (15ms)
      // Phase 2: High-speed sustained turbo sweet-spot (20ms)
      baseDelay = loadedCount < 2000 ? 15 : 20;
      break;
    case 'colossal':
    case 'galactic':
      baseDelay = 25;
      // Micro-breath pause every 5,000 items (120ms) to relax Telegram socket connection
      if (loadedCount > 0 && loadedCount % 5000 < 200) {
        baseDelay = 120;
        isMicroBreath = true;
      }
      break;
  }

  // Dynamic Flood-Shield Latency Compensation:
  // If network latency is elevated (> 200ms), increase backoff proportionally
  if (networkLatencyMs > 350) {
    baseDelay = Math.round(baseDelay * 2.2);
  } else if (networkLatencyMs > 200) {
    baseDelay = Math.round(baseDelay * 1.5);
  }

  return { delayMs: Math.max(8, baseDelay), isMicroBreath };
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
