import { describe, expect, it } from 'vitest';
import type { DriveFile } from './driveTypes';
import {
  driveSyncBackoffMs,
  getDriveLiveSyncPlan,
  reconcileDriveLiveHead,
} from './driveLiveSync';

const file = (id: number) => ({ id, name: `${id}.jpg` }) as DriveFile;

describe('Drive live synchronization', () => {
  it('polls less often and with smaller pages on constrained devices', () => {
    const high = getDriveLiveSyncPlan('high');
    const low = getDriveLiveSyncPlan('low');
    expect(low.intervalMs).toBeGreaterThan(high.intervalMs);
    expect(low.pageSize).toBeLessThan(high.pageSize);
  });

  it('replaces the live head and retains already-loaded older pages', () => {
    const merged = reconcileDriveLiveHead(
      [file(10), file(9), file(8), file(7), file(6)],
      [file(12), file(11), file(10), file(8)],
      true
    );
    expect(merged.map((item) => item.id)).toEqual([12, 11, 10, 8, 7, 6]);
  });

  it('uses the complete live result when the server says there is no next page', () => {
    expect(reconcileDriveLiveHead([file(3), file(2)], [file(4)], false)).toEqual([file(4)]);
  });

  it('backs off repeated failures within the device plan cap', () => {
    const plan = getDriveLiveSyncPlan('high');
    expect(driveSyncBackoffMs(plan, 1)).toBe(Math.min(plan.maxBackoffMs, plan.intervalMs * 2));
    expect(driveSyncBackoffMs(plan, 10)).toBe(plan.maxBackoffMs);
  });
});
