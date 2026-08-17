import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, X, Radio, ArrowUpRight, Database } from 'lucide-react';

export type DriveStorageInfoBadgeProps = {
  fileCount: number;
  totalCount?: number | null;
  spaceLabel?: string | null;
  statsLoading?: boolean;
  statsAccurate?: boolean;
  isFinal: boolean;
  transferBusy?: boolean;
  categoryCounts?: Record<string, number> | null;
  locationKey?: string;
};

export function DriveStorageInfoBadge({
  fileCount,
  totalCount,
  spaceLabel,
  statsLoading = false,
  statsAccurate = false,
  isFinal = false,
  transferBusy = false,
  categoryCounts = null,
  locationKey = 'root',
}: DriveStorageInfoBadgeProps) {
  const { t } = useTranslation();
  const [isAutoSplashVisible, setIsAutoSplashVisible] = useState(true);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const effectiveTotalCount = useMemo(() => {
    if (isFinal && fileCount > 0) return fileCount;
    if (totalCount != null && totalCount >= 0) return Math.max(totalCount, fileCount);
    return fileCount;
  }, [isFinal, fileCount, totalCount]);

  // Determine status color mode
  const statusMode = useMemo<'counting' | 'syncing' | 'accurate' | 'normal'>(() => {
    if (transferBusy) return 'syncing';
    if (statsLoading && !isFinal) return 'counting';
    if (statsAccurate || isFinal) return 'accurate';
    return 'normal';
  }, [transferBusy, statsLoading, statsAccurate, isFinal]);

  const startAutoDismissTimer = useCallback((durationMs = 4000) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIsAutoSplashVisible(false);
    }, durationMs);
  }, []);

  // 4-second initial splash timer on location switch
  useEffect(() => {
    setIsAutoSplashVisible(true);
    startAutoDismissTimer(4000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [locationKey, startAutoDismissTimer]);

  const handleMouseEnter = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isPopoverOpen) {
      startAutoDismissTimer(3000);
    }
  }, [isPopoverOpen, startAutoDismissTimer]);

  // Update popover position based on button rect
  const updateCoords = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const top = r.bottom + 8;
    const left = Math.max(14, Math.min(r.left, window.innerWidth - 340));
    setPopoverCoords({ top, left });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!isPopoverOpen) return;
    updateCoords();

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        btnRef.current &&
        !btnRef.current.contains(target)
      ) {
        setIsPopoverOpen(false);
        setIsAutoSplashVisible(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPopoverOpen(false);
        setIsAutoSplashVisible(false);
      }
    };

    const handleScroll = () => {
      updateCoords();
    };

    window.addEventListener('resize', updateCoords);
    window.addEventListener('scroll', handleScroll, true);
    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updateCoords);
      window.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPopoverOpen, updateCoords]);

  const handleToggleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    updateCoords();
    setIsPopoverOpen((prev) => {
      const next = !prev;
      if (!next) {
        setIsAutoSplashVisible(false);
      }
      return next;
    });
  }, [updateCoords]);

  const handleDismissSplash = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsAutoSplashVisible(false);
    setIsPopoverOpen(false);
  }, []);

  const statusLabel = useMemo(() => {
    switch (statusMode) {
      case 'syncing':
        return t('speedtest.storage_info_status_syncing');
      case 'counting':
        return t('speedtest.storage_info_status_counting');
      case 'accurate':
        return t('speedtest.storage_info_status_accurate');
      default:
        return t('speedtest.storage_info_status_estimate');
    }
  }, [statusMode, t]);

  const summaryText = useMemo(() => {
    const countFormatted = effectiveTotalCount.toLocaleString();
    const countPart = !isFinal && totalCount != null
      ? t('speedtest.items_total_estimate', { count: countFormatted })
      : t('speedtest.items_total_simple', { count: countFormatted, defaultValue: `${countFormatted} Items` });
    const spacePart = spaceLabel ? ` · ${spaceLabel}` : '';
    return `${countPart}${spacePart}`;
  }, [effectiveTotalCount, isFinal, totalCount, spaceLabel, t]);

  if (!isAutoSplashVisible && !isPopoverOpen) {
    return null;
  }

  return (
    <div
      className={`td-storage-info-wrapper td-status-${statusMode}${isPopoverOpen ? ' is-open' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 5-Second Interactive Storage Info Pill & Button */}
      <button
        ref={btnRef}
        type="button"
        className={`td-storage-splash-pill animate-fade-in ${isPopoverOpen ? 'active' : ''}`}
        onClick={handleToggleClick}
        title={t('speedtest.storage_info_tooltip_hint')}
        aria-label={t('speedtest.storage_info_badge_aria')}
        aria-expanded={isPopoverOpen}
      >
        <span className={`td-splash-dot td-dot-${statusMode}`} />
        <span className="td-splash-text">{summaryText}</span>
        <span
          className="td-splash-dismiss-btn"
          role="button"
          tabIndex={0}
          onClick={handleDismissSplash}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleDismissSplash(e as any);
            }
          }}
          title={t('speedtest.storage_info_close')}
          aria-label={t('speedtest.storage_info_close')}
        >
          <X size={12} />
        </span>
      </button>

      {/* Rich Popover Details Card Portal */}
      {isPopoverOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="td-storage-popover-card animate-scale-in"
          role="dialog"
          aria-label={t('speedtest.storage_info_title')}
          style={{
            position: 'fixed',
            top: `${popoverCoords.top}px`,
            left: `${popoverCoords.left}px`,
            zIndex: 99999,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Popover Header */}
          <div className="td-storage-popover-head">
            <div className="td-popover-head-title">
              <Database size={15} className="td-head-icon" />
              <span>{t('speedtest.storage_info_title')}</span>
            </div>
            <div className={`td-popover-status-badge td-badge-${statusMode}`}>
              {statusMode === 'counting' && <Loader2 size={12} className="animate-spin" />}
              {statusMode === 'accurate' && <CheckCircle2 size={12} />}
              {statusMode === 'syncing' && <Radio size={12} className="animate-pulse" />}
              <span>{statusLabel}</span>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="td-storage-metrics-grid">
            <div className="td-storage-metric-box">
              <span className="td-metric-label">{t('speedtest.storage_info_items')}</span>
              <strong className="td-metric-value">{effectiveTotalCount.toLocaleString()}</strong>
            </div>

            <div className="td-storage-metric-box">
              <span className="td-metric-label">{t('speedtest.storage_info_space')}</span>
              <strong className="td-metric-value">
                {spaceLabel ? spaceLabel : '—'}
              </strong>
            </div>
          </div>

          {/* Breakdown if categoryCounts exists */}
          {categoryCounts && Object.keys(categoryCounts).length > 0 && (
            <div className="td-storage-breakdown-section">
              <span className="td-breakdown-title">{t('speedtest.storage_info_breakdown')}</span>
              <div className="td-breakdown-pills">
                {Object.entries(categoryCounts).map(([cat, count]) => {
                  if (typeof count !== 'number' || count <= 0) return null;
                  return (
                    <div key={cat} className="td-breakdown-pill">
                      <span className="td-cat-name">{cat}</span>
                      <span className="td-cat-count">{count.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer Info */}
          <div className="td-storage-popover-footer">
            <span className="td-footer-hint">
              <ArrowUpRight size={12} />
              {t('speedtest.storage_info_tooltip_hint')}
            </span>
            <button
              type="button"
              className="td-popover-close-btn"
              onClick={() => {
                setIsPopoverOpen(false);
                setIsAutoSplashVisible(false);
              }}
            >
              {t('speedtest.storage_info_close')}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
