import { describe, it, expect } from 'vitest';
import { recomputeOverall } from './transferProgress';
import type { TransferSession } from '../../types/driveTransfer';

describe('transferProgress aggregate calculations', () => {
  it('computes weighted progress correctly across multiple items without jumping or resetting to 0', () => {
    const session: TransferSession = {
      active: true,
      paused: false,
      direction: 'upload',
      speed_mb_s: 2.5,
      overallPercent: 0,
      items: [
        {
          name: 'video1.mp4',
          status: 'done',
          percent: 100,
          phase: 'commit',
        },
        {
          name: 'video2.mp4',
          status: 'active',
          percent: 50,
          phase: 'upload',
        },
        {
          name: 'video3.mp4',
          status: 'preparing',
          percent: 80,
          phase: 'reencode',
        },
        {
          name: 'video4.mp4',
          status: 'queued',
          percent: 0,
        },
      ],
    };

    const updated = recomputeOverall(session);
    // Item 1: done -> 100%
    // Item 2: active upload 50% -> 15% (reencode done) + 50% of 80% (40%) = 55%
    // Item 3: preparing reencode 80% -> 80% of 15% = 12%
    // Item 4: queued -> 0%
    // Total sum = 100 + 55 + 12 + 0 = 167. Divided by 4 items = 41.75%
    expect(updated.overallPercent).toBeGreaterThan(40);
    expect(updated.overallPercent).toBeLessThan(45);
    expect(updated.overallPercent).toBeCloseTo(41.75, 1);
  });

  it('marks overall as 100 when all items are done or skipped', () => {
    const session: TransferSession = {
      active: false,
      paused: false,
      direction: 'upload',
      speed_mb_s: 0,
      overallPercent: 0,
      items: [
        { name: 'file1.jpg', status: 'done', percent: 100 },
        { name: 'file2.jpg', status: 'skipped', percent: 100 },
      ],
    };
    expect(recomputeOverall(session).overallPercent).toBe(100);
  });

  it('returns 0 when items array is empty', () => {
    const session: TransferSession = {
      active: false,
      paused: false,
      direction: 'upload',
      speed_mb_s: 0,
      overallPercent: 0,
      items: [],
    };
    expect(recomputeOverall(session).overallPercent).toBe(0);
  });
});
