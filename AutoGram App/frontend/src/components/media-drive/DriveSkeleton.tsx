import React, { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';

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
    setProgress(15);
    const t1 = setTimeout(() => setProgress(42), 180);
    const t2 = setTimeout(() => setProgress(72), 480);
    const t3 = setTimeout(() => setProgress(88), 900);
    const t4 = setTimeout(() => setProgress(96), 1600);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [isLoading, targetPercent]);

  return Math.min(100, Math.max(0, progress));
}

export interface CenteredGlassmorphicProgressProps {
  percent?: number;
  label?: string;
  isLoading?: boolean;
}

export const CenteredGlassmorphicProgress: React.FC<CenteredGlassmorphicProgressProps> = ({
  percent,
  label = 'Membaca katalog media Telegram MTProto...',
  isLoading = true,
}) => {
  const smoothProgress = useSmoothProgress(isLoading, percent);
  const displayPercent = Math.round(smoothProgress);
  const remainingSecs = Math.max(1, Math.ceil((100 - displayPercent) / 7));

  return (
    <div className="ag-compact-card select-none">
      {/* Brand Logo Box */}
      <div className="ag-logo-box">
        <Zap size={26} strokeWidth={2.5} />
      </div>

      {/* Brand Header */}
      <div className="ag-brand-block">
        <div className="ag-brand-name">AutoGram</div>
        <div className="ag-brand-sub">Syncing your media library</div>
      </div>

      {/* Progress Box */}
      <div className="ag-progress-box">
        <div className="ag-progress-header">
          <span className="ag-progress-label">Loading</span>
          <span className="ag-progress-percent">{displayPercent}%</span>
        </div>
        <div className="ag-slim-track">
          <div className="ag-slim-fill" style={{ width: `${smoothProgress}%` }} />
        </div>
      </div>

      {/* Context Text */}
      <div className="ag-context-text">
        {label ? (
          <span>{label}</span>
        ) : (
          <span>
            Scanning <strong>media files</strong> from Telegram MTProto
          </span>
        )}
      </div>

      {/* Estimate Text */}
      <div className="ag-estimate-text">
        {displayPercent >= 100
          ? 'Complete!'
          : displayPercent > 85
          ? 'Almost done...'
          : `~${remainingSecs} detik tersisa`}
      </div>
    </div>
  );
};

// Aliases for full backward compatibility
export const DeadCenterProgress = CenteredGlassmorphicProgress;
export const ModernProgressBar = CenteredGlassmorphicProgress;
export const MicroProgressBar = CenteredGlassmorphicProgress;

export const DriveGridSkeleton: React.FC<{ count?: number }> = ({ count = 12 }) => {
  const items = Array.from({ length: count });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', width: '100%' }}>
      {items.map((_, i) => (
        <div
          key={i}
          className="bg-[#181b22]/80 border border-white/5 rounded-xl p-2.5 flex flex-col justify-between"
          style={{ height: '210px', borderRadius: '14px', background: 'rgba(24, 27, 34, 0.8)', border: '1px solid rgba(255, 255, 255, 0.06)', padding: '10px' }}
        >
          <div className="skeleton-shimmer" style={{ width: '100%', height: '120px', borderRadius: '10px', marginBottom: '8px' }} />
          <div className="skeleton-shimmer" style={{ width: '75%', height: '14px', borderRadius: '4px', marginBottom: '6px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
            <div className="skeleton-shimmer" style={{ width: '48px', height: '12px', borderRadius: '4px' }} />
            <div className="skeleton-shimmer" style={{ width: '64px', height: '12px', borderRadius: '4px' }} />
          </div>
        </div>
      ))}
    </div>
  );
};

export const DriveListSkeleton: React.FC<{ count?: number }> = ({ count = 10 }) => {
  const items = Array.from({ length: count });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
      {items.map((_, i) => (
        <div
          key={i}
          className="skeleton-shimmer"
          style={{ height: '48px', borderRadius: '10px', background: 'rgba(24, 27, 34, 0.6)', border: '1px solid rgba(255, 255, 255, 0.06)' }}
        />
      ))}
    </div>
  );
};

export const ZipCatalogSkeleton: React.FC<{ count?: number }> = ({ count = 8 }) => {
  const items = Array.from({ length: count });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: '#13151b', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
      {items.map((_, i) => (
        <div key={i} className="skeleton-shimmer" style={{ height: '24px', borderRadius: '6px' }} />
      ))}
    </div>
  );
};

export const MediaPreviewSkeleton: React.FC = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '380px', background: '#13151b', borderRadius: '16px', padding: '16px' }}>
      <div className="skeleton-shimmer" style={{ width: '100%', height: '100%', borderRadius: '12px' }} />
    </div>
  );
};
