import React from 'react';
import { Trash2, RefreshCw } from 'lucide-react';
import { formatDriveBytes } from '../../lib/telegram/driveTypes';

export interface DataBackupSectionProps {
  cacheSizeBytes: number;
  isCalculating?: boolean;
  onCalculateCacheSize: () => void;
  onClearAllCaches: () => void;
  isClearingCache?: boolean;
}

export const DataBackupSection: React.FC<DataBackupSectionProps> = ({
  cacheSizeBytes,
  isCalculating,
  onCalculateCacheSize,
  onClearAllCaches,
  isClearingCache,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
      <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
        <Trash2 size={18} className="text-amber-400" />
        Manajemen Cache &amp; Pembersihan Storage
      </h3>

      <div className="flex items-center justify-between bg-slate-950 p-4 rounded-xl border border-slate-800">
        <div>
          <h4 className="font-semibold text-xs text-slate-200">Cache Media &amp; Thumbnail Lokal</h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Total ruang disk terpakai: <strong className="text-indigo-400 font-mono">{formatDriveBytes(cacheSizeBytes)}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isCalculating}
            onClick={onCalculateCacheSize}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all"
            title="Hitung Ulang Ukuran Cache"
          >
            <RefreshCw size={15} className={isCalculating ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            disabled={isClearingCache || cacheSizeBytes === 0}
            onClick={onClearAllCaches}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-xs font-semibold text-white rounded-lg transition-all flex items-center gap-1.5"
          >
            <Trash2 size={14} /> Bersihkan Cache
          </button>
        </div>
      </div>
    </div>
  );
};
