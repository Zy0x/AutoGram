import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDriveDuration } from '../../../lib/telegram/driveTypes';

type SplitVideoPlayerProps = {
  src: string | null;
  poster: string | null;
  loading: boolean;
  playbackRequested: boolean;
  backendBufferedPct: number;
  onRequestPlay: () => void;
  onSeek: (seconds: number, duration: number) => void;
};

export function SplitVideoPlayer({
  src,
  poster,
  loading,
  playbackRequested,
  backendBufferedPct,
  onRequestPlay,
  onSeek,
}: SplitVideoPlayerProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingPlayRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [browserBufferedPct, setBrowserBufferedPct] = useState(0);

  const updateBuffered = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    try {
      let bufferedEnd = 0;
      for (let index = 0; index < video.buffered.length; index += 1) {
        bufferedEnd = Math.max(bufferedEnd, video.buffered.end(index));
      }
      setBrowserBufferedPct(Math.min(100, Math.max(0, (bufferedEnd / video.duration) * 100)));
    } catch {
      // TimeRanges can change while Chromium is reading it.
    }
  }, []);

  const startPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    pendingPlayRef.current = false;
    void video.play().catch(() => {
      setIsPlaying(false);
    });
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!playbackRequested) {
      pendingPlayRef.current = false;
      video?.pause();
      setIsPlaying(false);
      return;
    }
    if (!src || !video) {
      pendingPlayRef.current = true;
      return;
    }
    pendingPlayRef.current = true;
    startPlayback();
  }, [playbackRequested, src, startPlayback]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!playbackRequested || !src || !video) {
      pendingPlayRef.current = true;
      onRequestPlay();
      return;
    }
    if (video.paused) {
      onRequestPlay();
      startPlayback();
    } else {
      video.pause();
    }
  };

  const effectiveBufferedPct = Math.max(browserBufferedPct, backendBufferedPct);
  const showPoster = !playbackRequested || !src;

  return (
    <div className="drive-preview-split-video-player" onPointerDown={(event) => event.stopPropagation()}>
      {showPoster ? (
        <div className="drive-preview-split-video-poster">
          {poster ? <img src={poster} alt="" draggable={false} /> : <div className="drive-preview-split-video-poster-empty" />}
          <button
            type="button"
            className="drive-preview-split-video-start"
            onClick={(event) => {
              event.stopPropagation();
              togglePlayback();
            }}
            aria-label={t('drive.preview_play_hint')}
          >
            <Play size={24} fill="currentColor" />
          </button>
          {loading && <span className="drive-preview-split-video-wait">{t('drive.label_loading')}</span>}
        </div>
      ) : (
        <video
          ref={videoRef}
          src={src}
          poster={poster || undefined}
          playsInline
          preload="metadata"
          onClick={togglePlayback}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedMetadata={(event) => {
            const nextDuration = Number(event.currentTarget.duration || 0);
            setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
            updateBuffered();
            if (pendingPlayRef.current) startPlayback();
          }}
          onTimeUpdate={(event) => {
            setCurrentTime(event.currentTarget.currentTime || 0);
            updateBuffered();
          }}
          onDurationChange={(event) => {
            const nextDuration = Number(event.currentTarget.duration || 0);
            setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
          }}
          onProgress={updateBuffered}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {playbackRequested && src && (
        <div className="drive-preview-split-video-controls">
          <div className="drive-preview-split-video-seek">
            <span className="drive-preview-split-video-buffer" style={{ width: `${effectiveBufferedPct}%` }} />
            <span
              className="drive-preview-split-video-elapsed"
              style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => {
                const seconds = Number(event.target.value || 0);
                const video = videoRef.current;
                setCurrentTime(seconds);
                if (video) video.currentTime = seconds;
                onSeek(seconds, duration);
              }}
              aria-label={t('drive.preview_seek_label')}
            />
          </div>
          <div className="drive-preview-split-video-control-row">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                togglePlayback();
              }}
              aria-label={t(isPlaying ? 'drive.preview_pause_hint' : 'drive.preview_play_hint')}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
            </button>
            <span>{formatDriveDuration(currentTime)} / {formatDriveDuration(duration)}</span>
            <span>{Math.round(effectiveBufferedPct)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
