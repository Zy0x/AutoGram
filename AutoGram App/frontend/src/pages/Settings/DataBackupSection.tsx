import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

  return (
    <div
      className="rounded-2xl p-5 space-y-4 shadow-xl border"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border-default)',
        color: 'var(--text-primary)',
      }}
    >
      <h3
        className="text-sm font-bold flex items-center gap-2 pb-3 border-b"
        style={{
          borderColor: 'var(--border-default)',
          color: 'var(--text-primary)',
        }}
      >
        <Trash2 size={18} className="text-amber-400" />
        {t('ui.generated.manajemen_cache_pembersihan_storage_bee9cc4')}
      </h3>

      <div
        className="flex items-center justify-between p-4 rounded-xl border"
        style={{
          background: 'var(--bg-elevated)',
          borderColor: 'var(--border-default)',
        }}
      >
        <div>
          <h4 className="font-semibold text-xs" style={{ color: 'var(--text-primary)' }}>
            {t('settings.local_media_cache_label')}
          </h4>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {t('settings.disk_usage')} <strong className="text-indigo-400 font-mono">{formatDriveBytes(cacheSizeBytes)}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isCalculating}
            onClick={onCalculateCacheSize}
            className="p-2 rounded-lg transition-all"
            style={{
              color: 'var(--text-secondary)',
            }}
            title={t('settings.recalculate_cache_tooltip')}
          >
            <RefreshCw size={15} className={isCalculating ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            disabled={isClearingCache || cacheSizeBytes === 0}
            onClick={onClearAllCaches}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-xs font-semibold text-white rounded-lg transition-all flex items-center gap-1.5"
          >
            <Trash2 size={14} /> {t('settings.clear_cache')}
          </button>
        </div>
      </div>
    </div>
  );
};
