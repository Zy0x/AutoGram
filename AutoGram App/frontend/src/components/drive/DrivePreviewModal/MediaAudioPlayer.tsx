import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Music } from 'lucide-react';
import { formatDriveDuration } from '../../../lib/telegram/driveTypes';

type MediaAudioPlayerProps = {
  src: string;
  title: string;
  artist?: string;
  posterSrc?: string | null;
  autoPlay?: boolean;
};

export const MediaAudioPlayer: React.FC<MediaAudioPlayerProps> = ({
  src,
  title,
  artist,
  posterSrc,
  autoPlay = true,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (audioRef.current && autoPlay) {
      audioRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [src, autoPlay]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (audioRef.current) {
      audioRef.current.volume = val;
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.volume = volume || 1;
      setIsMuted(false);
    } else {
      audioRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col items-center justify-center p-6 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md text-slate-100 select-none">
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="relative w-48 h-48 sm:w-56 sm:h-56 mb-6 rounded-2xl overflow-hidden shadow-2xl bg-gradient-to-br from-indigo-900/40 to-slate-900 border border-slate-800 flex items-center justify-center">
        {posterSrc ? (
          <img src={posterSrc} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-indigo-400">
            <Music className="w-16 h-16 animate-pulse" />
            <span className="text-xs font-mono uppercase tracking-widest text-slate-500">Audio Track</span>
          </div>
        )}
      </div>

      <div className="text-center mb-6 w-full px-4 min-w-0">
        <h4 className="font-semibold text-base sm:text-lg text-slate-100 truncate" title={title}>
          {title}
        </h4>
        {artist && <p className="text-xs text-slate-400 truncate mt-1">{artist}</p>}
      </div>

      <div className="w-full px-2 mb-4">
        <div className="relative flex items-center">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>
        <div className="flex justify-between text-[11px] font-mono text-slate-400 mt-1.5">
          <span>{formatDriveDuration(currentTime)}</span>
          <span>{formatDriveDuration(duration)}</span>
        </div>
      </div>

      <div className="w-full flex items-center justify-between px-2">
        <div className="w-24" />
        <button
          onClick={togglePlay}
          className="w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 transition-all hover:scale-105 active:scale-95"
        >
          {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
        </button>
        <div className="flex items-center gap-2 w-28 justify-end">
          <button onClick={toggleMute} className="text-slate-400 hover:text-slate-200 transition-colors">
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>
      </div>
    </div>
  );
};
