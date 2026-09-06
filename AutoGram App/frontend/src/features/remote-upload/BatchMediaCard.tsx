import React from 'react';
import { Check, Clock, Film, Image as ImageIcon } from 'lucide-react';
import { formatDriveBytes } from '../../lib/telegram/driveTypes';
import { formatMediaDuration, type BatchMediaItem } from './domain';

interface BatchMediaCardProps {
  item: BatchMediaItem;
  isSelected: boolean;
  isFocused: boolean;
  itemDur?: number;
  onCardClick: (item: BatchMediaItem) => void;
  onCardDoubleClick: (item: BatchMediaItem) => void;
  onToggleItem: (id: string) => void;
  t: (key: string, options?: any) => string;
}

export const BatchMediaCard = React.memo(function BatchMediaCard({
  item,
  isSelected,
  isFocused,
  itemDur,
  onCardClick,
  onCardDoubleClick,
  onToggleItem,
  t,
}: BatchMediaCardProps) {
  const extMatch = item.filename.match(/\.([a-zA-Z0-9]+)$/);
  const extName = extMatch ? extMatch[1].toUpperCase() : '';
  const baseName = extMatch ? item.filename.slice(0, extMatch.index) : item.filename;

  return (
    <div
      className={`td-remote-media-item-card card-grid-mode ${isSelected ? 'selected' : ''} ${isFocused ? 'is-active-preview' : ''}`}
      onClick={() => onCardClick(item)}
      onDoubleClick={() => onCardDoubleClick(item)}
    >
      <div className="td-remote-item-thumb-wrap">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.title} className="td-remote-item-thumb-img" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : (
          <div className="td-remote-item-thumb-fallback">
            {item.isVideo ? <Film size={26} /> : <ImageIcon size={26} />}
          </div>
        )}
        {item.qualityBadge && <span className="td-remote-item-quality-badge tier-fhd">{item.qualityBadge}</span>}
        <button
          type="button"
          className={`td-remote-item-checkbox ${isSelected ? 'checked' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleItem(item.id);
          }}
          aria-label={isSelected ? t('drive_tools.remote_gallery_deselect_all') : t('drive_tools.remote_gallery_select_all')}
        >
          {isSelected && <Check size={9.5} strokeWidth={3.8} />}
        </button>
      </div>
      <div className="td-remote-item-card-body">
        <span className="td-remote-item-card-title" title={item.filename}>
          <span className="td-remote-title-base">{baseName}</span>
          {extName ? <span className="td-remote-title-ext">.{extName}</span> : null}
        </span>
        <div className="td-remote-card-meta-row">
          {item.filesizeBytes ? <span className="td-remote-meta-size">~{formatDriveBytes(item.filesizeBytes)}</span> : <span />}
          {itemDur ? (
            <span className="td-remote-item-duration-badge">
              <Clock size={10} />
              <span>{formatMediaDuration(itemDur)}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
});
