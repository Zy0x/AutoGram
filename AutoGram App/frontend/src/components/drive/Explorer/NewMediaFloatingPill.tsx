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
