import React from 'react';
import type { ThumbnailMode } from '../types';

interface ThumbnailQualityBadgeProps {
  mode: ThumbnailMode;
}

export const ThumbnailQualityBadge: React.FC<ThumbnailQualityBadgeProps> = ({ mode }) => {
  const badgeColors = {
    saver: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    balance: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    high: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };

  return (
    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${badgeColors[mode]}`}>
      {mode}
    </span>
  );
};
