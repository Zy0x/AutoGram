import type { PerfTier } from './devicePerformance';
import type { DriveFile } from './driveTypes';

export type DriveLiveSyncPlan = {
  intervalMs: number;
  focusMinAgeMs: number;
  pageSize: number;
  maxBackoffMs: number;
};

export function getDriveLiveSyncPlan(tier: PerfTier): DriveLiveSyncPlan {
  // Slightly calmer intervals reduce Telegram + IPC overhead under load.
  if (tier === 'low') {
    return { intervalMs: 75_000, focusMinAgeMs: 25_000, pageSize: 8, maxBackoffMs: 5 * 60_000 };
  }
  if (tier === 'mid') {
    return { intervalMs: 40_000, focusMinAgeMs: 12_000, pageSize: 12, maxBackoffMs: 3 * 60_000 };
  }
  return { intervalMs: 22_000, focusMinAgeMs: 8_000, pageSize: 16, maxBackoffMs: 2 * 60_000 };
}

export function dedupeByMsgId(files: DriveFile[]): DriveFile[] {
  const seen = new Set<number>();
  const result: DriveFile[] = [];
  for (const file of files) {
    if (file != null && !seen.has(file.id)) {
      seen.add(file.id);
      result.push(file);
    }
  }
  return result;
}

/**
 * Replace the authoritative newest window while retaining pages the user has
 * already loaded below it. Missing ids inside that newest id range are treated
 * as deleted; older loaded rows remain available without a full history walk.
 */
export function reconcileDriveLiveHead(
  previous: DriveFile[],
  liveHead: DriveFile[],
  serverHasMore: boolean
): DriveFile[] {
  if (!serverHasMore) return dedupeByMsgId(liveHead);
  if (!liveHead.length) return dedupeByMsgId(previous);
  const liveIds = new Set(liveHead.map((file) => file.id));
  const oldestLiveId = Math.min(...liveHead.map((file) => file.id));
  const retainedTail = previous.filter(
    (file) => file.id < oldestLiveId && !liveIds.has(file.id)
  );
  return dedupeByMsgId([...liveHead, ...retainedTail]);
}

export function driveSyncBackoffMs(
  plan: DriveLiveSyncPlan,
  consecutiveFailures: number
): number {
  const multiplier = Math.max(1, 2 ** Math.min(4, consecutiveFailures));
  return Math.min(plan.maxBackoffMs, plan.intervalMs * multiplier);
}
