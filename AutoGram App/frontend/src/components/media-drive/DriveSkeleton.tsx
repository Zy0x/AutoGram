import React, { useEffect, useState } from 'react';

/**
 * Hook for smooth realistic progress interpolation (0% -> 100%)
 */
export function useSmoothProgress(isLoading: boolean = true, targetPercent?: number): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setProgress(100);
      return;
    }

    if (targetPercent !== undefined && targetPercent > 0) {
      setProgress(targetPercent);
      return;
    }

    // Realistic multi-stage smooth progress curve (0% -> 100%)
    setProgress(12);
    const t1 = setTimeout(() => setProgress(38), 180);
    const t2 = setTimeout(() => setProgress(68), 480);
    const t3 = setTimeout(() => setProgress(85), 900);
    const t4 = setTimeout(() => setProgress(94), 1600);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [isLoading, targetPercent]);

  return Math.min(100, Math.max(0, progress));
}

export interface ModernProgressBarProps {
  percent?: number;
  label?: string;
  isLoading?: boolean;
  isIndeterminate?: boolean;
}

export const ModernProgressBar: React.FC<ModernProgressBarProps> = ({
  percent,
  label = 'Memuat data...',
  isLoading = true,
}) => {
  const smoothProgress = useSmoothProgress(isLoading, percent);
  const displayPercent = Math.round(smoothProgress);

  return (
    <div className="w-full mb-5 select-none transition-all duration-300">
      <div className="bg-[#141720]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] relative overflow-hidden">
        {/* Ambient Top Glow Border */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
        
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0 pr-3">
            {/* Live Pulsing Status Indicator */}
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500" />
            </span>
            <span className="text-xs font-semibold text-slate-200 tracking-wide truncate">
              {label}
            </span>
          </div>

          {/* Real Percent Badge (0% - 100%) */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-950/70 border border-cyan-500/30 text-cyan-300 font-mono text-xs font-bold shrink-0 shadow-inner">
            <span>{displayPercent}%</span>
          </div>
        </div>

        {/* Progress Track */}
        <div className="h-2 w-full bg-slate-900/90 rounded-full p-0.5 border border-white/5 shadow-inner relative overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-amber-400 transition-all duration-300 ease-out shadow-[0_0_12px_rgba(6,182,212,0.6)] relative"
            style={{ width: `${smoothProgress}%` }}
          >
            {/* Glowing Tip Accent */}
            <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/80 rounded-full shadow-[0_0_8px_#ffffff]" />
          </div>
        </div>
      </div>
    </div>
  );
};

// Backward compatibility alias
export const MicroProgressBar = ModernProgressBar;

export const DriveGridSkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => {
  const items = Array.from({ length: count });
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {items.map((_, i) => (
        <div
          key={i}
          className="bg-[#181b22]/80 border border-white/5 rounded-xl p-2.5 flex flex-col justify-between h-[210px]"
        >
          {/* Thumbnail area (aspect ratio 4:3) */}
          <div className="w-full h-[120px] skeleton-shimmer rounded-lg mb-2" />
          
          {/* Title line */}
          <div className="w-3/4 h-3.5 skeleton-shimmer rounded mb-1.5" />
          
          {/* Badge line */}
          <div className="flex items-center justify-between gap-2 mt-auto pt-1">
            <div className="w-12 h-3 skeleton-shimmer rounded" />
            <div className="w-16 h-3 skeleton-shimmer rounded" />
          </div>
        </div>
      ))}
    </div>
  );
};

export const DriveListSkeleton: React.FC<{ count?: number }> = ({ count = 10 }) => {
  const items = Array.from({ length: count });
  return (
    <div className="flex flex-col gap-2 w-full">
      {items.map((_, i) => (
        <div
          key={i}
          className="bg-[#181b22]/70 border border-white/5 rounded-lg p-3 flex items-center justify-between"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
            <div className="w-8 h-8 skeleton-shimmer rounded-lg shrink-0" />
            <div className="w-1/2 h-4 skeleton-shimmer rounded shrink-0" />
          </div>
          <div className="w-20 h-3 skeleton-shimmer rounded hidden sm:block pr-4" />
          <div className="w-24 h-3 skeleton-shimmer rounded hidden md:block pr-4" />
          <div className="w-16 h-6 skeleton-shimmer rounded" />
        </div>
      ))}
    </div>
  );
};

export const ZipCatalogSkeleton: React.FC<{ count?: number }> = ({ count = 8 }) => {
  const items = Array.from({ length: count });
  return (
    <div className="flex flex-col gap-2 p-3 bg-[#13151b] border border-white/5 rounded-xl">
      <div className="flex items-center justify-between pb-2 border-b border-white/5 mb-1">
        <div className="w-36 h-4 skeleton-shimmer rounded" />
        <div className="w-16 h-3 skeleton-shimmer rounded" />
      </div>
      {items.map((_, i) => (
        <div key={i} className="flex items-center justify-between py-1.5 px-2">
          <div className="flex items-center gap-2 flex-1">
            <div className="w-4 h-4 skeleton-shimmer rounded shrink-0" />
            <div
              className="h-3.5 skeleton-shimmer rounded"
              style={{ width: `${Math.floor(30 + (i * 7) % 50)}%` }}
            />
          </div>
          <div className="w-14 h-3 skeleton-shimmer rounded shrink-0" />
        </div>
      ))}
    </div>
  );
};

export const MediaPreviewSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-[380px] bg-[#13151b] border border-white/5 rounded-2xl p-4">
      {/* Header bar */}
      <div className="w-full flex items-center justify-between pb-4 mb-4 border-b border-white/5">
        <div className="w-48 h-4 skeleton-shimmer rounded" />
        <div className="flex gap-2">
          <div className="w-8 h-8 skeleton-shimmer rounded-lg" />
          <div className="w-8 h-8 skeleton-shimmer rounded-lg" />
        </div>
      </div>
      {/* Center media viewer */}
      <div className="w-full flex-1 skeleton-shimmer rounded-xl max-h-[280px]" />
    </div>
  );
};
