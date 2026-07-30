import { useTranslation } from 'react-i18next';
import React from 'react';
import { HardDrive, PieChart } from 'lucide-react';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import { formatDriveBytes, isVideoDriveFile, isImageDriveFile, isAudioDriveFile, isPdfDriveFile, isZipDriveFile } from '../../../lib/telegram/driveTypes';

export interface SpaceUsageTabProps {
  files: DriveFile[];
  locationLabel: string;
  totalCount: number;
  totalBytes: number;
}

export const SpaceUsageTab: React.FC<SpaceUsageTabProps> = ({
  files,
  locationLabel,
  totalCount,
  totalBytes,
}) => {
  const { t } = useTranslation();
  const videoBytes = files.filter(isVideoDriveFile).reduce((acc, f) => acc + f.size, 0);
  const imageBytes = files.filter(isImageDriveFile).reduce((acc, f) => acc + f.size, 0);
  const audioBytes = files.filter(isAudioDriveFile).reduce((acc, f) => acc + f.size, 0);
  const pdfBytes = files.filter(isPdfDriveFile).reduce((acc, f) => acc + f.size, 0);
  const archiveBytes = files.filter(isZipDriveFile).reduce((acc, f) => acc + f.size, 0);
  const otherBytes = Math.max(0, totalBytes - (videoBytes + imageBytes + audioBytes + pdfBytes + archiveBytes));

  const calcPct = (b: number) => (totalBytes > 0 ? ((b / totalBytes) * 100).toFixed(1) : '0');

  return (
    <div className="space-y-4 text-slate-100">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-indigo-600/20 text-indigo-400 rounded-xl border border-indigo-500/30">
            <HardDrive size={24} />
          </div>
          <div>
            <h4 className="font-semibold text-sm text-slate-100">{locationLabel}</h4>
            <p className="text-xs text-slate-400">{totalCount.toLocaleString('id-ID')} total file terindeks</p>
          </div>
        </div>
        <div className="text-right font-mono">
          <span className="text-base font-bold text-indigo-400">{formatDriveBytes(totalBytes)}</span>
          <p className="text-[10px] text-slate-500">Kapasitas terpakai</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <h4 className="font-semibold text-xs text-slate-300 flex items-center gap-2">
          <PieChart size={14} className="text-indigo-400" /> Rincian Penggunaan Berdasarkan Jenis Media
        </h4>

        <div className="h-3 w-full bg-slate-950 rounded-full overflow-hidden flex">
          <div style={{ width: `${calcPct(videoBytes)}%` }} className="bg-indigo-500" title="Video" />
          <div style={{ width: `${calcPct(imageBytes)}%` }} className="bg-emerald-500" title="Gambar" />
          <div style={{ width: `${calcPct(audioBytes)}%` }} className="bg-amber-500" title="Audio" />
          <div style={{ width: `${calcPct(archiveBytes)}%` }} className="bg-purple-500" title="Arsip" />
          <div style={{ width: `${calcPct(otherBytes)}%` }} className="bg-slate-600" title="Lainnya" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 text-xs">
          <div className="p-2 bg-slate-950/60 rounded-lg border border-slate-800/80">
            <span className="text-indigo-400 font-medium">{t('speedtest.space_cat_videos')}</span>
            <p className="font-mono text-slate-200 mt-0.5">{formatDriveBytes(videoBytes)} ({calcPct(videoBytes)}%)</p>
          </div>
          <div className="p-2 bg-slate-950/60 rounded-lg border border-slate-800/80">
            <span className="text-emerald-400 font-medium">{t('speedtest.space_cat_images')}</span>
            <p className="font-mono text-slate-200 mt-0.5">{formatDriveBytes(imageBytes)} ({calcPct(imageBytes)}%)</p>
          </div>
          <div className="p-2 bg-slate-950/60 rounded-lg border border-slate-800/80">
            <span className="text-amber-400 font-medium">{t('speedtest.space_cat_audio')}</span>
            <p className="font-mono text-slate-200 mt-0.5">{formatDriveBytes(audioBytes)} ({calcPct(audioBytes)}%)</p>
          </div>
          <div className="p-2 bg-slate-950/60 rounded-lg border border-slate-800/80">
            <span className="text-purple-400 font-medium">{t('speedtest.space_cat_archives')}</span>
            <p className="font-mono text-slate-200 mt-0.5">{formatDriveBytes(archiveBytes)} ({calcPct(archiveBytes)}%)</p>
          </div>
          <div className="p-2 bg-slate-950/60 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 font-medium">{t('speedtest.space_cat_other')}</span>
            <p className="font-mono text-slate-200 mt-0.5">{formatDriveBytes(otherBytes)} ({calcPct(otherBytes)}%)</p>
          </div>
        </div>
      </div>
    </div>
  );
};
