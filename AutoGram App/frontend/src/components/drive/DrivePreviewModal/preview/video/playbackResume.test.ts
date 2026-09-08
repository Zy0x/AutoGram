import { describe, expect, it, vi } from 'vitest';
import { canPersistPlayback, playbackObservation, restorePlaybackPosition } from './playbackResume';

function media(ranges: number[][] = [[0, 50], [590, 600]]) {
  return {
    currentTime: 300, duration: 600, paused: false, ended: false, seeking: false,
    buffered: { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] },
  };
}

describe('remember position with adaptive buffer', () => {
  it('does not tell Data Saver that a tail island is a complete file', () => {
    expect(playbackObservation(media(), false)).toEqual({ runway: null, observation: 'not_observable' });
    expect(playbackObservation({ ...media(), paused: true }, false)).toEqual({ runway: null, observation: 'idle' });
  });
  it('measures only actual runway at the resume position', () => {
    expect(playbackObservation(media([[0, 50], [299, 302], [590, 600]]), false))
      .toEqual({ runway: 2, observation: 'measured' });
  });
  it('preserves steady-state pacing measurements and explicit completion', () => {
    expect(playbackObservation(media([[299, 350]]), false)).toEqual({ runway: 50, observation: 'measured' });
    expect(playbackObservation(media(), true)).toEqual({ runway: 300, observation: 'complete' });
  });
  it('distinguishes missing metadata from missing ranges', () => {
    expect(playbackObservation({ ...media(), duration: NaN }, false).observation).toBe('waiting_metadata');
    expect(playbackObservation(null, false).observation).toBe('not_observable');
  });
  it('resets stale runway before seeking once and suppresses the approximate seek handler', () => {
    const player = media(); player.currentTime = 0;
    const pending = { current: 300 }, ignored = { current: 0 }, userSeek = { current: true };
    const reset = vi.fn(() => expect(player.currentTime).toBe(0));
    expect(restorePlaybackPosition(player, pending, reset, ignored, userSeek)).toBe(true);
    expect(player.currentTime).toBe(300);
    expect(pending.current).toBe(0);
    expect(ignored.current).toBe(1);
    expect(userSeek.current).toBe(false);
    expect(restorePlaybackPosition(player, pending, reset, ignored, userSeek)).toBe(false);
    expect(reset).toHaveBeenCalledTimes(1);
  });
  it('retains the target until metadata becomes available', () => {
    const pending = { current: 300 }, ignored = { current: 0 }, userSeek = { current: false };
    const reset = vi.fn();
    expect(restorePlaybackPosition({ duration: NaN, currentTime: 0 }, pending, reset, ignored, userSeek)).toBe(false);
    expect(pending.current).toBe(300);
    expect(reset).not.toHaveBeenCalled();
    expect(restorePlaybackPosition(media(), pending, reset, ignored, userSeek)).toBe(true);
  });
  it('rolls back event suppression after a rejected assignment and allows retry', () => {
    const pending = { current: 300 }, ignored = { current: 2 }, userSeek = { current: false };
    const player = { duration: 600, get currentTime() { return 0; }, set currentTime(_value: number) { throw new Error('not ready'); } };
    expect(restorePlaybackPosition(player, pending, vi.fn(), ignored, userSeek)).toBe(false);
    expect(pending.current).toBe(300);
    expect(ignored.current).toBe(2);
    expect(restorePlaybackPosition(media(), pending, vi.fn(), ignored, userSeek)).toBe(true);
  });
  it.each([0, NaN, 600, 700])('discards an invalid saved target %s', target => {
    const pending = { current: target }, ignored = { current: 0 };
    expect(restorePlaybackPosition(media(), pending, vi.fn(), ignored, { current: false })).toBe(false);
    expect(pending.current).toBe(0);
    expect(ignored.current).toBe(0);
  });
  it('does not overwrite history before or during the resume seek', () => {
    expect(canPersistPlayback(media(), 300)).toBe(false);
    expect(canPersistPlayback({ ...media(), seeking: true }, 0)).toBe(false);
    expect(canPersistPlayback(media(), 0)).toBe(true);
    expect(canPersistPlayback({ ...media(), ended: true }, 0)).toBe(false);
  });
});
