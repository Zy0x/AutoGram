import { measurePlayableBuffer } from './startupPolicy';

type Media = Pick<HTMLMediaElement, 'currentTime' | 'duration' | 'buffered' | 'paused' | 'ended' | 'seeking'>;

/** A suffix fetched for metadata is not a buffer at the resume destination. */
export function playbackObservation(player: Media | null, complete: boolean) {
  if (!player) return { runway: null, observation: 'not_observable' } as const;
  if (!Number.isFinite(player.duration) || player.duration <= 0) {
    return { runway: null, observation: 'waiting_metadata' } as const;
  }
  const measured = measurePlayableBuffer(player);
  if (complete) {
    return { runway: Math.max(0, player.duration - player.currentTime), observation: 'complete' } as const;
  }
  return {
    runway: measured.runway,
    observation: player.paused ? 'idle' : measured.runway == null ? 'not_observable' : 'measured',
  } as const;
}

/** Apply once. The media element requests exact byte ranges for this timestamp. */
export function restorePlaybackPosition(
  player: Pick<HTMLMediaElement, 'duration' | 'currentTime'> | null,
  pending: { current: number },
  resetRunway: () => void,
  ignoredSeeks: { current: number },
  userSeekPending: { current: boolean },
): boolean {
  const target = pending.current;
  if (!player || !Number.isFinite(player.duration) || player.duration <= 0) return false;
  if (!Number.isFinite(target) || target <= 0.5 || target >= player.duration) {
    pending.current = 0;
    return false;
  }
  resetRunway();
  ignoredSeeks.current += 1;
  userSeekPending.current = false;
  try {
    player.currentTime = target;
    pending.current = 0;
    return true;
  } catch {
    ignoredSeeks.current = Math.max(0, ignoredSeeks.current - 1);
    // Metadata can change during source handoff; keep the target for retry.
    return false;
  }
}

export function canPersistPlayback(player: Media | null, pendingPosition: number): boolean {
  return Boolean(player && pendingPosition === 0 && !player.seeking && !player.ended
    && Number.isFinite(player.currentTime) && Number.isFinite(player.duration));
}
