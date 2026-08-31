import { describe, expect, it } from 'vitest';
import type { TransferItem, TransferSession } from '../telegram/driveTypes';
import { EMPTY_TRANSFER_SESSION } from '../telegram/driveTypes';
import { recomputeOverall, transferItemOverallPercent } from './transferProgress';

function item(patch: Partial<TransferItem>): TransferItem {
  return {
    id: 'item',
    index: 0,
    name: 'sample.mp4',
    direction: 'upload',
    status: 'queued',
    percent: 0,
    transferred: 0,
    total: 100,
    speed_mb_s: 0,
    ...patch,
  };
}

function session(items: TransferItem[]): TransferSession {
  return { ...EMPTY_TRANSFER_SESSION, active: true, direction: 'upload', items };
}

describe('transfer progress aggregation', () => {
  it('keeps phase progress cumulative across re-encode, upload, and commit', () => {
    expect(transferItemOverallPercent(item({ status: 'preparing', phase: 'reencode', percent: 50 }))).toBe(17.5);
    expect(transferItemOverallPercent(item({ status: 'active', phase: 'upload', percent: 50 }))).toBe(62.5);
    expect(transferItemOverallPercent(item({ status: 'committing', phase: 'committing', percent: 100 }))).toBe(98);
    expect(transferItemOverallPercent(item({ status: 'done', percent: 100 }))).toBe(100);
  });

  it('shows aggregate progress instead of the active item percentage', () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item({
        id: `item-${index}`,
        index,
        ...(index === 0
          ? { status: 'active' as const, phase: 'upload', percent: 50, transferred: 50 }
          : {}),
      })
    );
    expect(recomputeOverall(session(items)).overallPercent).toBe(6.25);
  });

  it('weights large items without treating re-encode counters as uploaded bytes', () => {
    const result = recomputeOverall(session([
      item({ id: 'large', total: 900, status: 'preparing', phase: 'reencode', percent: 100, transferred: 9999 }),
      item({ id: 'small', index: 1, total: 100, status: 'done', percent: 100, transferred: 100 }),
    ]));
    expect(result.overallPercent).toBe(37);
    expect(result.transferred).toBe(100);
  });

  it('correctly calculates 0% overall progress when all items fail', () => {
    const result = recomputeOverall(session([
      item({ id: 'f1', total: 500, status: 'failed', percent: 0, transferred: 0 }),
      item({ id: 'f2', index: 1, total: 500, status: 'failed', percent: 0, transferred: 0 }),
    ]));
    expect(result.overallPercent).toBe(0);
    expect(result.transferred).toBe(0);
  });

  it('correctly calculates partial progress when some items succeed and others fail', () => {
    const result = recomputeOverall(session([
      item({ id: 'ok1', total: 500, status: 'done', percent: 100, transferred: 500 }),
      item({ id: 'fail1', index: 1, total: 500, status: 'failed', percent: 0, transferred: 0 }),
    ]));
    expect(result.overallPercent).toBe(50);
    expect(result.transferred).toBe(500);
  });
});
