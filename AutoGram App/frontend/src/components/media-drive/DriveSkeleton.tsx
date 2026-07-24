import React, { useEffect, useState } from 'react';
import { Rocket } from 'lucide-react';

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

export interface DeadCenterProgressProps {
  percent?: number;
  label?: string;
  isLoading?: boolean;
}

export const DeadCenterProgress: React.FC<DeadCenterProgressProps> = ({
  percent,
  label = 'Membaca katalog media Telegram MTProto...',
  isLoading = true,
}) => {
  const smoothProgress = useSmoothProgress(isLoading, percent);
  const displayPercent = Math.round(smoothProgress);

  return (
    <div className="flex flex-col items-center justify-center min-h-[380px] w-full p-6 select-none my-auto">
      <div className="flex flex-col items-center max-w-lg w-full relative">
        {/* Track Container with Mascot Runner */}
        <div className="relative w-full h-16 flex items-end mb-2">
          {/* Animated Mascot / Rocket Runner riding on top of the progress bar */}
          <div
            className="absolute bottom-3 transition-all duration-300 ease-out z-20 flex flex-col items-center pointer-events-none"
            style={{
              left: `clamp(0px, calc(${smoothProgress}% - 22px), calc(100% - 44px))`,
            }}
          >
            <div className="relative transform -rotate-12 animate-bounce">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 to-amber-400 p-0.5 shadow-[0_4px_16px_rgba(6,182,212,0.6)] flex items-center justify-center">
                <div className="w-full h-full bg-[#141720] rounded-[14px] flex items-center justify-center text-cyan-300">
                  <Rocket size={20} className="transform rotate-45 text-cyan-400" />
                </div>
              </div>
              {/* Flame / Thriller Aura */}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-2 bg-amber-400/80 blur-[3px] rounded-full" />
            </div>
          </div>

          {/* Thick Rounded Pill Track (matching reference image) */}
          <div className="h-5 w-full bg-[#181b24] rounded-full p-1 border border-white/10 shadow-[inner_0_2px_8px_rgba(0,0,0,0.6)] relative overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-amber-400 transition-all duration-300 ease-out shadow-[0_0_16px_rgba(6,182,212,0.8)] relative"
              style={{ width: `${smoothProgress}%` }}
            >
              {/* Head Highlight */}
              <div className="absolute right-0 top-0 bottom-0 w-2.5 bg-white/90 rounded-full shadow-[0_0_10px_#ffffff]" />
            </div>
          </div>
        </div>

        {/* Centered Large Percentage Text (matching reference image) */}
        <div className="text-2xl font-bold font-mono text-cyan-300 tracking-wider text-center drop-shadow-[0_2px_10px_rgba(6,182,212,0.4)] mt-1">
          {displayPercent}%
        </div>

        {/* Status Label Text below percent */}
        {label && (
          <div className="text-xs text-slate-400 mt-2 text-center font-medium max-w-sm tracking-wide leading-relaxed">
            {label}
          </div>
        )}
      </div>
    </div>
  );
};

// Aliases for full backward compatibility
export const ModernProgressBar = DeadCenterProgress;
export const MicroProgressBar = DeadCenterProgress;

export const DriveGridSkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => {
  const items = Array.from({ length: count });
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {items.map((_, i) => (
        <div
          key={i}
          className="bg-[#181b22]/80 border border-white/5 rounded-xl p-2.5 flex flex-col justify-between h-[210px]"
        >
          <div className="w-full h-[120px] skeleton-shimmer rounded-lg mb-2" />
          <div className="w-3/4 h-3.5 skeleton-shimmer rounded mb-1.5" />
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
      <div className="w-full flex items-center justify-between pb-4 mb-4 border-b border-white/5">
        <div className="w-48 h-4 skeleton-shimmer rounded" />
        <div className="flex gap-2">
          <div className="w-8 h-8 skeleton-shimmer rounded-lg" />
          <div className="w-8 h-8 skeleton-shimmer rounded-lg" />
        </div>
      </div>
      <div className="w-full flex-1 skeleton-shimmer rounded-xl max-h-[280px]" />
    </div>
  );
};
