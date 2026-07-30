import React from 'react';

interface DownloadProgressProps {
  progress: number; // 0 to 100
}

export const DownloadProgress: React.FC<DownloadProgressProps> = ({ progress }) => {
  return (
    <div className="w-full bg-slate-700/60 rounded-full h-1.5 overflow-hidden">
      <div
        className="bg-indigo-500 h-full transition-all duration-200 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
};
