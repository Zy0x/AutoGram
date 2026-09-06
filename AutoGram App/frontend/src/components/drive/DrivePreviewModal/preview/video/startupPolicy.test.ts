import { describe, expect, it } from 'vitest';
import { canNudgePlayback, isPlaybackHealthy, isStreamComplete, measurePlayableBuffer } from './startupPolicy';
describe('progressive preview startup', () => {
  it('does not mistake a high tail buffer for playable startup data', () => {
    const result = measurePlayableBuffer({ currentTime: 0, duration: 100, buffered: { length: 1, start: () => 80, end: () => 100 } });
    expect(result.hasData).toBe(false);
    expect(result.runway).toBeNull();
  });
  it('uses the range containing currentTime, not the furthest buffered island', () => {
    expect(measurePlayableBuffer({ currentTime: 1, duration: 100, buffered: { length: 2, start: i => [0,80][i], end: i => [3,100][i] } })).toMatchObject({ runway: 2, percent: 3, hasData: true });
  });
  it('never marks 98 percent of a sparse file complete', () => {
    expect(isStreamComplete({}, 100000, 98000)).toBe(false);
    expect(isStreamComplete({}, 100000, 100000)).toBe(true);
    expect(isStreamComplete({ done: true }, 0, 0)).toBe(true);
  });
  it('does not repeatedly seek the decoder during first-frame startup', () => {
    const player = { currentTime: 0, readyState: 1, paused: false, seeking: false, ended: false };
    expect(canNudgePlayback(player)).toBe(false);
    expect(isPlaybackHealthy(player, true)).toBe(false);
    expect(canNudgePlayback({ ...player, currentTime: 1, readyState: 3 })).toBe(true);
    expect(canNudgePlayback({ ...player, currentTime: 1, readyState: 3, seeking: true })).toBe(false);
  });
});
