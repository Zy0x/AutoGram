import React, { useEffect, useState } from 'react';
import { Zap, Image as ImageIcon } from 'lucide-react';

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

    // Fast responsive multi-stage progress curve (0% -> 100%)
    setProgress(25);
    const t1 = setTimeout(() => setProgress(58), 120);
    const t2 = setTimeout(() => setProgress(82), 320);
    const t3 = setTimeout(() => setProgress(94), 650);
    const t4 = setTimeout(() => setProgress(98), 1200);

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
  label,
  isLoading = true,
}) => {
  const smoothProgress = useSmoothProgress(isLoading, percent);
  const displayPercent = Math.round(smoothProgress);
  const remainingSecs = Math.max(1, Math.ceil((100 - displayPercent) / 12));

  // Dynamic context message based on progress stage
  const dynamicStatus = label || (
    displayPercent < 35
      ? 'Menghubungkan Telegram MTProto…'
      : displayPercent < 70
      ? 'Membaca katalog media drive…'
      : displayPercent < 90
      ? 'Menyusun metadata & file…'
      : 'Hampir selesai…'
  );

  return (
    <div className="ag-compact-card select-none">
      {/* Outer Pulse Glow Ring */}
      <div className="ag-logo-wrapper">
        <div className="ag-logo-box">
          <Zap size={26} strokeWidth={2.5} />
        </div>
      </div>

      {/* Brand Header */}
      <div className="ag-brand-block">
        <div className="ag-brand-name">AutoGram</div>
        <div className="ag-brand-sub">Syncing your media library</div>
      </div>

      {/* Progress Box */}
      <div className="ag-progress-box">
        <div className="ag-progress-header">
          <span className="ag-progress-label">Memuat Katalog</span>
          <span className="ag-progress-percent">{displayPercent}%</span>
        </div>
        <div className="ag-slim-track">
          <div className="ag-slim-fill" style={{ width: `${smoothProgress}%` }} />
        </div>
      </div>

      {/* Context Text */}
      <div className="ag-context-text">
        <span>{dynamicStatus}</span>
      </div>

      {/* Estimate Text */}
      <div className="ag-estimate-text">
        {displayPercent >= 100
          ? 'Selesai!'
          : displayPercent > 88
          ? 'Menyiapkan tampilan…'
          : `~${remainingSecs} detik tersisa`}
      </div>
    </div>
  );
};

// Aliases for full backward compatibility
export const DeadCenterProgress = CenteredGlassmorphicProgress;
export const ModernProgressBar = CenteredGlassmorphicProgress;
export const MicroProgressBar = CenteredGlassmorphicProgress;

export const DriveGridSkeleton: React.FC<{ count?: number }> = ({ count = 16 }) => {
  const items = Array.from({ length: count });
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
        gap: '14px',
        width: '100%',
        padding: '4px',
      }}
    >
      {items.map((_, i) => (
        <div
          key={i}
          className="ag-skeleton-card"
        >
          {/* Thumbnail Box Skeleton */}
          <div className="ag-skeleton-thumb skeleton-shimmer">
            <div className="ag-skeleton-icon-placeholder">
              <ImageIcon size={22} className="opacity-20 text-white/40" />
            </div>
            <div className="ag-skeleton-badge skeleton-shimmer" />
          </div>

          {/* Title & Metadata Skeleton */}
          <div className="ag-skeleton-details">
            <div className="skeleton-shimmer ag-skeleton-line-title" style={{ width: `${65 + (i % 4) * 10}%` }} />
            <div className="ag-skeleton-meta-row">
              <div className="skeleton-shimmer ag-skeleton-pill" style={{ width: '48px' }} />
              <div className="skeleton-shimmer ag-skeleton-pill" style={{ width: '56px' }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export const DriveListSkeleton: React.FC<{ count?: number }> = ({ count = 10 }) => {
  const items = Array.from({ length: count });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', padding: '4px' }}>
      {items.map((_, i) => (
        <div key={i} className="ag-skeleton-list-row">
          <div className="skeleton-shimmer ag-skeleton-list-icon" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div className="skeleton-shimmer" style={{ width: `${40 + (i % 3) * 15}%`, height: '14px', borderRadius: '4px' }} />
            <div className="skeleton-shimmer" style={{ width: '120px', height: '11px', borderRadius: '3px', opacity: 0.6 }} />
          </div>
          <div className="skeleton-shimmer" style={{ width: '70px', height: '14px', borderRadius: '4px' }} />
        </div>
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

