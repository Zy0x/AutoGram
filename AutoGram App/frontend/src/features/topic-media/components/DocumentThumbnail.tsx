import React from 'react';
import type { TopicMediaItem } from '../types';
import { FileTypeIcon } from './FileTypeIcon';

interface DocumentThumbnailProps {
  item: TopicMediaItem;
  className?: string;
}

export const DocumentThumbnail: React.FC<DocumentThumbnailProps> = ({ item, className = 'w-full h-full' }) => {
  if (item.thumbUrl) {
    return (
      <img
        src={item.thumbUrl}
        alt={item.fileName}
        className={`${className} object-cover rounded-md`}
        loading="lazy"
      />
    );
  }

  return (
    <div className={`${className} flex flex-col items-center justify-center bg-slate-800/80 rounded-md p-2 border border-slate-700/50`}>
      <FileTypeIcon mimeType={item.mimeType} fileName={item.fileName} className="w-10 h-10 mb-1" />
      <span className="text-[11px] text-slate-300 truncate max-w-full font-medium px-1">
        {item.fileName}
      </span>
    </div>
  );
};
