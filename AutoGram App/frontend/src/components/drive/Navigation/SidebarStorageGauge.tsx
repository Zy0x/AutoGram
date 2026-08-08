import React from 'react';
import { HardDrive } from 'lucide-react';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import { useTranslation } from 'react-i18next';

export interface SidebarStorageGaugeProps {
  usedBytes: number;
  totalLimitBytes?: number;
  activeSession: string;
  isOnline?: boolean;
}

export const SidebarStorageGauge: React.FC<SidebarStorageGaugeProps> = ({
  usedBytes,
  totalLimitBytes = 2 * 1024 * 1024 * 1024 * 1024, // 2 TB default
    }) => {
  const { t } = useTranslation();
  const percentage = Math.min(100, Math.round((usedBytes / totalLimitBytes) * 100));

  return (
    <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <HardDrive size={14} className="text-indigo-400" /> {t('ui.generated.telegram_cloud_drive_56ffe79')}
        </span>
        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {t('ui.generated.grammers_e93195e')}
        </span>
      </div>

      <div className="space-y-1">
        <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
            style={{ width: `${Math.max(3, percentage)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <span>{formatDriveBytes(usedBytes)}</span>
          <span>{t('speedtest.unlimited_cloud')}</span>
        </div>
      </div>
    </div>
  );
};
