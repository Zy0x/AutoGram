import { describe, expect, it } from 'vitest';
import { parseBatchPositions, runWithConcurrency } from './batchExecution';

describe('batch execution', () => {
  it('normalizes one-based positions, ranges, duplicates, and out-of-range values', () => {
    expect(parseBatchPositions('1, 3-5, 5, 99, nope', 6)).toEqual([0, 2, 3, 4]);
    expect(parseBatchPositions('4-2', 4)).toEqual([1, 2, 3]);
  });

  it('never exceeds the requested concurrency and visits each item once', async () => {
    let active = 0;
    let peak = 0;
    const visited: number[] = [];
    await runWithConcurrency(9, 3, async (index) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      visited.push(index);
      active -= 1;
    });
    expect(peak).toBe(3);
    expect(visited.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
