import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize2, Minimize2 } from 'lucide-react';
import { formatDriveDuration } from '../../../lib/driveTypes';

type MediaVideoPlayerProps = {
  src: string;
  posterSrc?: string | null;
  autoPlay?: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
  onSeek?: (seconds: number) => void;
  bufferedPct?: number;
  qualityLabel?: string;
  onQualityMenuToggle?: () => void;
};

export const MediaVideoPlayer: React.FC<MediaVideoPlayerProps> = ({
  src,
  posterSrc,
  autoPlay = true,
  onTimeUpdate,
  onEnded,
  onSeek,
  bufferedPct = 0,
  qualityLabel,
  onQualityMenuToggle,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [browserBufferedPct, setBrowserBufferedPct] = useState(0);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (videoRef.current && autoPlay) {
      videoRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [src, autoPlay]);

  const handleProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration || v.duration <= 0) return;
    try {
      const b = v.buffered;
      if (b && b.length > 0) {
        let maxBufferedTime = 0;
        for (let i = 0; i < b.length; i++) {
          if (b.start(i) <= v.currentTime && v.currentTime <= b.end(i) + 0.5) {
            maxBufferedTime = Math.max(maxBufferedTime, b.end(i));
          }
        }
        if (maxBufferedTime === 0 && b.length > 0) {
          maxBufferedTime = b.end(b.length - 1);
        }
        const pct = Math.min(100, Math.max(0, (maxBufferedTime / v.duration) * 100));
        setBrowserBufferedPct(pct);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    handleProgress();
    if (onTimeUpdate) {
      onTimeUpdate(v.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    handleProgress();
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
    } else {
      v.play();
    }
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = parseFloat(e.target.value);
    setCurrentTime(targetTime);
    if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
    }
    if (onSeek) {
      onSeek(targetTime);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.volume = volume || 1;
      setIsMuted(false);
    } else {
      videoRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  const effectiveBufferPct = Math.max(browserBufferedPct, bufferedPct);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative w-full h-full flex items-center justify-center bg-black overflow-hidden select-none group"
    >
      <video
        ref={videoRef}
        src={src}
        poster={posterSrc || undefined}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onProgress={handleProgress}
        onEnded={onEnded}
        onClick={togglePlay}
        className="max-w-full max-h-full object-contain cursor-pointer"
      />

      <div
        className={`absolute inset-x-0 bottom-0 z-30 p-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-300 ${
          showControls || !isPlaying ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="relative w-full mb-3 group/seek">
          <div className="absolute inset-y-0 my-auto h-1.5 w-full bg-slate-800 rounded-lg overflow-hidden pointer-events-none">
            <div
              style={{ width: `${effectiveBufferPct}%` }}
              className="h-full bg-slate-600/80 transition-all duration-150"
            />
          </div>

          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeekChange}
            className="relative z-10 w-full h-1.5 bg-transparent appearance-none cursor-pointer accent-indigo-500"
          />
        </div>

        <div className="flex items-center justify-between text-slate-100">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="p-2 rounded-lg hover:bg-white/10 text-slate-200 hover:text-white transition-all"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
            </button>

            <div className="flex items-center gap-2">
              <button onClick={toggleMute} className="p-1 text-slate-300 hover:text-white">
                {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            <div className="text-xs font-mono text-slate-300 ml-2">
              <span>{formatDriveDuration(currentTime)}</span>
              <span className="text-slate-500 mx-1">/</span>
              <span>{formatDriveDuration(duration)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {qualityLabel && onQualityMenuToggle && (
              <button
                onClick={onQualityMenuToggle}
                className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs font-semibold text-indigo-300 border border-indigo-400/30 transition-all"
              >
                {qualityLabel}
              </button>
            )}

            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-all"
              title="Fullscreen"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
