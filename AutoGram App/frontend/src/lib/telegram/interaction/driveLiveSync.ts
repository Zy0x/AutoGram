import type { PerfTier } from '../../utils/devicePerformance';
import type { DriveFile } from '../driveTypes';

export type DriveLiveSyncPlan = {
  intervalMs: number;
  focusMinAgeMs: number;
  pageSize: number;
  maxBackoffMs: number;
};

export function getDriveLiveSyncPlan(tier: PerfTier): DriveLiveSyncPlan {
  // Interval lebih cepat untuk deteksi media baru yang lebih responsif.
  // focusMinAgeMs diturunkan agar tab-switch langsung trigger sync.
  if (tier === 'low') {
    return { intervalMs: 60_000, focusMinAgeMs: 20_000, pageSize: 8, maxBackoffMs: 5 * 60_000 };
  }
  if (tier === 'mid') {
    return { intervalMs: 25_000, focusMinAgeMs: 8_000, pageSize: 12, maxBackoffMs: 3 * 60_000 };
  }
  // high tier: agresif tapi masih aman dari FloodWait
  return { intervalMs: 12_000, focusMinAgeMs: 4_000, pageSize: 16, maxBackoffMs: 2 * 60_000 };
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

export function purgeDeletedMsgIds(files: DriveFile[], deletedIds: number[]): DriveFile[] {
  if (!deletedIds || !deletedIds.length || !files || !files.length) return files || [];
  const deletedSet = new Set(deletedIds.map((id) => Number(id)));
  return files.filter((f) => f && !deletedSet.has(Number(f.id)));
}

/**
 * Replace the authoritative newest window while retaining pages the user has
 * already loaded below it. Missing ids inside that newest id range are treated
 * as deleted; older loaded rows remain available without a full history walk.
 */
export function reconcileDriveLiveHead(
  previous: DriveFile[],
  liveHead: DriveFile[],
  serverHasMore: boolean,
  opts?: { isExplicitRefresh?: boolean; knownDeletedIds?: number[] }
): DriveFile[] {
  if (opts?.knownDeletedIds && opts.knownDeletedIds.length) {
    previous = purgeDeletedMsgIds(previous, opts.knownDeletedIds);
  }
  if (!liveHead.length) return dedupeByMsgId(previous);
  if (!serverHasMore && previous.length <= liveHead.length) return dedupeByMsgId(liveHead);

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

