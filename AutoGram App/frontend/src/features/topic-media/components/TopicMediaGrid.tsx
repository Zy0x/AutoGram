import React, { useCallback } from 'react';
import type { TopicMediaContext, TopicMediaItem as MediaItemType } from '../types';
import { useThumbnailMode } from '../useThumbnailMode';
import { useTopicMedia } from '../useTopicMedia';
import { useTopicMediaViewport } from '../useTopicMediaViewport';
import { ThumbnailQualityBadge } from './ThumbnailQualityBadge';
import { TopicMediaItem } from './TopicMediaItem';
import { TopicMediaSkeleton } from './TopicMediaSkeleton';
import { useTranslation } from 'react-i18next';

interface TopicMediaGridProps {
  context: TopicMediaContext | null;
  session?: string;
  apiId?: number;
  apiHash?: string;
  onItemClick?: (item: MediaItemType) => void;
}

export const TopicMediaGrid: React.FC<TopicMediaGridProps> = ({
  context,
  session,
  apiId,
  apiHash,
  onItemClick,
}) => {
  const { t } = useTranslation();
  const { items, status, hasMore, loadMore } = useTopicMedia(context, session, apiId, apiHash);
  const [thumbMode, setThumbMode] = useThumbnailMode();

  const handleViewportChange = useCallback((indices: number[]) => {
    if (hasMore && indices.some((i) => i >= items.length - 8)) {
      loadMore();
    }
  }, [hasMore, items.length, loadMore]);

  const containerRef = useTopicMediaViewport(handleViewportChange);

  if (status === 'loading-cache' && items.length === 0) {
    return <TopicMediaSkeleton count={12} />;
  }

  if (items.length === 0 && status !== 'syncing') {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <svg className="w-12 h-12 mb-3 text-slate-500 stroke-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="text-sm font-medium">{t('ui.generated.tidak_ada_media_ditemukan_dalam_topik_ini_8601380')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/60 border-b border-slate-800 text-xs text-slate-400">
        <div className="flex items-center space-x-2">
          <span>{t('ui.generated.total_media_3f51a37')} <strong className="text-slate-200">{items.length}</strong></span>
          {status === 'syncing' && (
            <span className="inline-flex items-center text-indigo-400 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mr-1.5" />
              {t('ui.generated.menyingkronkan_data_real_time_ba5f92a')}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-[11px]">{t('ui.generated.kualitas_thumbnail_b8833c0')}</span>
          <div className="flex bg-slate-800 rounded p-0.5 border border-slate-700">
            {(['saver', 'balance', 'high'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setThumbMode(m)}
                className={`px-2 py-0.5 text-[10px] uppercase font-mono rounded transition-colors ${
                  thumbMode === m
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <ThumbnailQualityBadge mode={thumbMode} />
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {items.map((item, idx) => (
          <TopicMediaItem key={`${item.messageId}-${idx}`} item={item} index={idx} onClick={onItemClick} />
        ))}
      </div>
    </div>
  );
};
