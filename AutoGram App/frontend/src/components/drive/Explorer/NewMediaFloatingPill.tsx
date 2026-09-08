import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Sparkles, X } from 'lucide-react';

export type PreviewThumbItem = {
  id: number;
  url?: string | null;
  name?: string;
};

export type NewMediaFloatingPillProps = {
  kind: 'added' | 'updated' | 'removed' | 'reordered';
  count: number;
  previewThumbs?: PreviewThumbItem[];
  onClick: () => void;
  onDismiss: () => void;
};

export const NewMediaFloatingPill: React.FC<NewMediaFloatingPillProps> = memo(({
  kind,
  count,
  previewThumbs = [],
  onClick,
  onDismiss,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className="td-floating-top-pill-anchor"
      role="region"
      aria-label={t('drive.scroll_to_top_title')}
    >
      <div
        role="button"
        tabIndex={0}
        className="td-floating-top-pill"
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        title={t('drive.scroll_to_top_title')}
      >
        {/* 1-3 micro thumbnails stacked on left */}
        {previewThumbs.length > 0 && (
          <div className="td-floating-top-thumbs" aria-hidden="true">
            {previewThumbs.map((item, idx) => (
              <div
                key={`pill-thumb-${item.id || idx}`}
                className="td-floating-top-thumb-item"
                title={item.name || undefined}
              >
                {item.url ? (
                  <img
                    src={item.url}
                    alt=""
                    className="td-floating-top-thumb-img"
                    loading="eager"
                  />
                ) : (
                  <Sparkles className="td-floating-top-thumb-icon" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Bouncing up arrow */}
        <ArrowUp size={14} className="td-floating-top-icon" aria-hidden="true" />

        {/* Count & localized label */}
        <span className="td-floating-top-text">
          {t(`drive.content_notice_${kind}`, { count })}
        </span>

        {/* View action button */}
        <span className="td-floating-top-action">
          {t('drive.view_top_action')}
        </span>

        {/* Dismiss '×' button */}
        <button
          type="button"
          className="td-floating-top-close"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          title={t('drive.dismiss_notice')}
          aria-label={t('drive.dismiss_notice')}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
});

NewMediaFloatingPill.displayName = 'NewMediaFloatingPill';

/**
 * Calculates the index of the first visible item in the scroll container.
 */
export function calculateVisibleStartIndex(
  scrollTop: number,
  viewMode: 'grid' | 'list',
  rowHeight: number,
  cols: number,
  listRowHeight = 44
): number {
  const top = Math.max(0, scrollTop);
  if (viewMode === 'list') {
    return Math.floor(top / Math.max(1, listRowHeight));
  }
  const safeCols = Math.max(1, cols);
  const safeRowH = Math.max(1, rowHeight);
  const rowIdx = Math.floor(top / safeRowH);
  return rowIdx * safeCols;
}

/**
 * Calculates remaining unseen new items above the current visible position.
 * When user is below the new items, returns totalNewCount.
 * As user scrolls up into the new items, count decreases dynamically per row/item.
 * When user reaches the top (visibleStartIndex <= 0), returns 0.
 */
export function calculateRemainingNewCount(
  totalNewCount: number,
  visibleStartIndex: number
): number {
  if (totalNewCount <= 0 || visibleStartIndex <= 0) return 0;
  return Math.min(totalNewCount, visibleStartIndex);
}

/**
 * Seamlessly accumulates newly arrived uploads with remaining unseen items.
 */
export function accumulateNewMediaCount(
  currentRemaining: number,
  newlyArrivedCount: number
): number {
  return Math.max(0, currentRemaining) + Math.max(0, newlyArrivedCount);
}
