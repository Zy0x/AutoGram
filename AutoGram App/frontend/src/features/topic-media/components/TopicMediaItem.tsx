import React from 'react';
import type { TopicMediaItem as MediaItemType } from '../types';
import { DocumentThumbnail } from './DocumentThumbnail';

interface TopicMediaItemProps {
  item: MediaItemType;
  index: number;
  onClick?: (item: MediaItemType) => void;
}

export const TopicMediaItem: React.FC<TopicMediaItemProps> = ({ item, index, onClick }) => {
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div
      data-index={index}
      onClick={() => onClick?.(item)}
      className="group relative aspect-square bg-slate-900/80 rounded-lg overflow-hidden border border-slate-800 hover:border-indigo-500/50 transition-all duration-200 cursor-pointer shadow-md hover:shadow-indigo-500/10 flex flex-col"
    >
      <div className="flex-1 w-full h-full relative flex items-center justify-center overflow-hidden">
        {item.thumbUrl ? (
          <img
            src={item.thumbUrl}
            alt={item.fileName}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <DocumentThumbnail item={item} />
        )}

        {item.mediaType === 'video' && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <svg className="w-10 h-10 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
      </div>

      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent p-2 pt-6 flex flex-col justify-end">
        <span className="text-xs font-medium text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
          {item.fileName}
        </span>
        <div className="flex items-center justify-between mt-0.5 text-[10px] text-slate-400">
          <span>{formatSize(item.fileSize)}</span>
          <span className="uppercase text-[9px] font-mono px-1 rounded bg-slate-800 text-slate-400">
            {item.mediaType}
          </span>
        </div>
      </div>
    </div>
  );
};
