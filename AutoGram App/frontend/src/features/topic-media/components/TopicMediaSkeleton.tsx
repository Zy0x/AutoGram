import React from 'react';

interface TopicMediaSkeletonProps {
  count?: number;
}

export const TopicMediaSkeleton: React.FC<TopicMediaSkeletonProps> = ({ count = 12 }) => {
  const items = Array.from({ length: count });

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 p-4">
      {items.map((_, i) => (
        <div key={i} className="aspect-square bg-slate-800/60 animate-pulse rounded-lg border border-slate-700/30 flex flex-col justify-end p-2">
          <div className="h-3 bg-slate-700/50 rounded w-3/4 mb-1" />
          <div className="h-2 bg-slate-700/40 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
};
