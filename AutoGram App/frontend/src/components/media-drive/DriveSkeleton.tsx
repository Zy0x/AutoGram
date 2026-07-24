import React from 'react';

export interface MicroProgressBarProps {
  percent?: number;
  label?: string;
  isIndeterminate?: boolean;
}

export const MicroProgressBar: React.FC<MicroProgressBarProps> = ({
  percent = 0,
  label,
  isIndeterminate = false,
}) => {
  const clampPercent = Math.min(100, Math.max(0, percent));
  return (
    <div className="w-full mb-3 select-none">
      <div className="micro-progress-container">
        <div
          className={`micro-progress-fill ${isIndeterminate ? 'indeterminate' : ''}`}
          style={{ width: isIndeterminate ? '40%' : `${clampPercent}%` }}
        />
      </div>
      {label && (
        <div className="flex items-center justify-between mt-1 px-1 text-[11px] text-slate-400 font-medium">
          <span className="truncate pr-2">{label}</span>
          {!isIndeterminate && <span>{Math.round(clampPercent)}%</span>}
        </div>
      )}
    </div>
  );
};

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
