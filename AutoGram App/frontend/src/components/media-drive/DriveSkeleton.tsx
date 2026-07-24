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
    setProgress(14);
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

  return (
    <div className="ag-glass-card">
      <div className="ag-glass-card-top-glow" />

      {/* Glowing Mascot Header */}
      <div className="ag-mascot-header">
        <div className="ag-mascot-ring">
          <div className="ag-mascot-inner">
            <Rocket size={32} style={{ transform: 'rotate(45deg)' }} />
          </div>
        </div>
      </div>

      {/* Track & Mascot Runner */}
      <div className="ag-track-container">
        {/* Runner Badge */}
        <div
          className="ag-runner-badge"
          style={{
            left: `clamp(0px, calc(${smoothProgress}% - 14px), calc(100% - 28px))`,
          }}
        >
          <div className="ag-runner-icon">
            <div className="ag-runner-icon-inner">
              <Rocket size={14} style={{ transform: 'rotate(45deg)' }} />
            </div>
          </div>
        </div>

        {/* Track */}
        <div className="ag-progress-track">
          <div className="ag-progress-fill" style={{ width: `${smoothProgress}%` }}>
            <div className="ag-progress-tip" />
          </div>
        </div>
      </div>

      {/* Large 28px Monospaced Percent Counter */}
      <div className="ag-percent-counter">{displayPercent}%</div>

      {/* Status Pill */}
      {label && (
        <div className="ag-status-pill">
          <span className="ag-pulsing-dot" />
          <span>{label}</span>
        </div>
      )}
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
