import React from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  Info,
  Maximize2,
  Minimize2,
  ExternalLink,
} from 'lucide-react';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import { driveFileDisplayName, formatDriveBytes } from '../../../lib/telegram/driveTypes';
import { isDesktop } from '../../../lib/tauri/platform';

export interface MediaHeaderToolbarProps {
  file: DriveFile;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onDownload: () => void;
  onPrintPdf?: () => void;
  isPdf?: boolean;
  onOpenSystem?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  showInfo?: boolean;
  onToggleInfo?: () => void;
  saving?: boolean;
  openingSystem?: boolean;
}

export const MediaHeaderToolbar: React.FC<MediaHeaderToolbarProps> = ({
  file,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onDownload,
  onPrintPdf,
  isPdf,
  onOpenSystem,
    isFullscreen,
  onToggleFullscreen,
  showInfo,
  onToggleInfo,
  saving,
  openingSystem,
}) => {
  const displayName = driveFileDisplayName(file);

  return (
    <header className="drive-preview-header">
      <div className="drive-preview-title" title={displayName}>
        <span className="font-semibold text-sm text-slate-100">{displayName}</span>
        <span className="text-xs text-slate-400 font-mono ml-2">({formatDriveBytes(file.size)})</span>
      </div>

      <div className="flex items-center gap-1.5">
        {onPrev && (
          <button
            type="button"
            disabled={!hasPrev}
            onClick={onPrev}
            className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80 disabled:opacity-40"
            title="File Sebelumnya (Panah Kiri)"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        {onNext && (
          <button
            type="button"
            disabled={!hasNext}
            onClick={onNext}
            className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80 disabled:opacity-40"
            title="File Berikutnya (Panah Kanan)"
          >
            <ChevronRight size={18} />
          </button>
        )}

        {isDesktop() && onOpenSystem && (
          <button
            type="button"
            disabled={openingSystem}
            onClick={onOpenSystem}
            className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80"
            title="Buka Aplikasi Sistem"
          >
            <ExternalLink size={16} />
          </button>
        )}

        {isPdf && onPrintPdf && (
          <button
            type="button"
            onClick={onPrintPdf}
            className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80"
            title="Cetak PDF"
          >
            <Printer size={16} />
          </button>
        )}

        <button
          type="button"
          disabled={saving}
          onClick={onDownload}
          className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80"
          title="Download File"
        >
          <Download size={16} />
        </button>

        {onToggleInfo && (
          <button
            type="button"
            onClick={onToggleInfo}
            className={`p-1.5 rounded-lg transition-colors ${
              showInfo ? 'text-indigo-400 bg-indigo-950/60' : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
            }`}
            title="Detail Info File"
          >
            <Info size={16} />
          </button>
        )}

        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80"
            title={isFullscreen ? 'Keluar Layar Penuh' : 'Layar Penuh'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-red-500/20 hover:text-red-300 ml-1"
          title="Tutup (ESC)"
        >
          <X size={18} />
        </button>
      </div>
    </header>
  );
};
