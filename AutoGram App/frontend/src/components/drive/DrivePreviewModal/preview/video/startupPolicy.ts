type PlayerState = Pick<HTMLVideoElement, 'currentTime' | 'readyState' | 'paused' | 'seeking' | 'ended'>;

type StartupReadiness = {
  streamReady?: boolean;
  moovReady?: boolean;
  browserHasData: boolean;
  readyState: number;
};

/** Tail islands do not provide runway at the current playback position. */
export function measurePlayableBuffer(video: Pick<HTMLVideoElement, 'buffered' | 'currentTime' | 'duration'>) {
  let end = 0;
  let runway: number | null = null;
  try {
    for (let index = 0; index < video.buffered.length; index += 1) {
      if (video.buffered.start(index) <= video.currentTime + 0.05 && video.buffered.end(index) > video.currentTime) {
        end = video.buffered.end(index);
        runway = Math.max(0, end - video.currentTime);
        break;
      }
    }
  } catch { /* The browser may replace TimeRanges between reads. */ }
  return { runway, hasData: runway !== null && runway > 0.05,
    percent: Number.isFinite(video.duration) && video.duration > 0 ? 100 * end / video.duration : 0 };
}

export function isPlaybackHealthy(video: PlayerState | null, hasData: boolean): boolean {
  return Boolean(video && !video.paused && !video.seeking && video.readyState >= 2 && video.currentTime > 0.05 && hasData);
}

/**
 * Startup must not wait for the backend's prefix watermark. Once MP4 metadata
 * is known, the browser can issue the first Range request and grow the normal
 * playback buffer itself. The watermark remains useful for pacing/telemetry,
 * but it is not an admission gate for the first frame.
 */
export function canStartPlayback(readiness: StartupReadiness): boolean {
  return Boolean(
    readiness.streamReady ||
    readiness.moovReady ||
    readiness.browserHasData ||
    readiness.readyState >= 2
  );
}

/** Seeking the same timestamp while demux/decoder initializes restarts startup. */
export function canNudgePlayback(video: PlayerState): boolean {
  return !video.paused && !video.ended && !video.seeking && video.readyState >= 3 && video.currentTime > 0.05;
}

export function isStreamComplete(status: { done?: boolean; status?: string }, total: number, prefix: number): boolean {
  return status.done === true || status.status === 'done' || (total > 0 && prefix >= total);
}
