import React from 'react';
import {
  X,
  Download,
  ExternalLink,
  Printer,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Sliders,
  Check,
} from 'lucide-react';
import { DriveFile, formatDriveBytes } from '../../../lib/telegram/driveTypes';
import { PlayQuality } from './previewUtils';

type MediaHeaderToolbarProps = {
  file: DriveFile;
  kind: 'video' | 'audio' | 'image' | 'text' | 'pdf' | 'zip' | 'other';
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  qualities: PlayQuality[];
  selectedQuality: string;
  onSelectQuality: (q: string) => void;
  showQualityMenu: boolean;
  setShowQualityMenu: React.Dispatch<React.SetStateAction<boolean>>;
  qualityBtnRef: React.RefObject<HTMLButtonElement | null>;
  qualityMenuPosition: { top: number; left: number; width: number } | null;
  qualityMetaNote: string | null;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onRotate: () => void;
  onDownload: () => void;
  onOpenSystem: () => void;
  onPrintPdf?: () => void;
  isDownloading?: boolean;
  isOpenSystem?: boolean;
};

export const MediaHeaderToolbar: React.FC<MediaHeaderToolbarProps> = ({
  file,
  kind,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  qualities,
  selectedQuality,
  onSelectQuality,
  showQualityMenu,
  setShowQualityMenu,
  qualityBtnRef,
  qualityMenuPosition,
  qualityMetaNote,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onRotate,
  onDownload,
  onOpenSystem,
  onPrintPdf,
  isDownloading,
  isOpenSystem,
}) => {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-3 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-slate-100 select-none">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1">
          {onPrev && (
            <button
              onClick={onPrev}
              disabled={!hasPrev}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              title="Prev (Left Arrow)"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {onNext && (
            <button
              onClick={onNext}
              disabled={!hasNext}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              title="Next (Right Arrow)"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm sm:text-base text-slate-100 truncate max-w-xs sm:max-w-md md:max-w-lg" title={file.name}>
            {file.name}
          </h3>
          <p className="text-xs text-slate-400 font-mono flex items-center gap-2">
            <span>{formatDriveBytes(file.size)}</span>
            {file.mime_type && <span className="opacity-60">• {file.mime_type}</span>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {qualities.length > 0 && (
          <div className="relative">
            <button
              ref={qualityBtnRef}
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700/60 transition-all"
              title="Video Quality"
            >
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>{selectedQuality.toUpperCase()}</span>
            </button>

            {showQualityMenu && qualityMenuPosition && (
              <div
                style={{
                  position: 'fixed',
                  top: `${qualityMenuPosition.top}px`,
                  left: `${qualityMenuPosition.left}px`,
                  width: `${qualityMenuPosition.width}px`,
                }}
                className="z-50 py-1.5 bg-slate-900/95 border border-slate-700/80 rounded-xl shadow-2xl backdrop-blur-md text-xs"
              >
                <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800 mb-1 flex items-center justify-between">
                  <span>Stream Quality</span>
                  {qualityMetaNote && <span className="text-[10px] text-amber-400 font-normal">{qualityMetaNote}</span>}
                </div>
                {qualities.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => {
                      onSelectQuality(q.id);
                      setShowQualityMenu(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-slate-800 transition-colors ${
                      selectedQuality === q.id ? 'text-indigo-400 font-medium bg-indigo-950/30' : 'text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {q.label}
                      {q.recommended && <span className="px-1.5 py-0.5 text-[9px] bg-indigo-500/20 text-indigo-300 rounded font-normal">REC</span>}
                    </span>
                    {selectedQuality === q.id && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {kind === 'image' && (
          <div className="hidden sm:flex items-center gap-1 bg-slate-800/80 border border-slate-700/60 rounded-lg p-0.5">
            <button
              onClick={onZoomOut}
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-all"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={onResetZoom}
              className="px-2 text-xs font-mono text-slate-300 hover:text-white transition-colors"
              title="Reset Zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={onZoomIn}
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-all"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-slate-700 mx-0.5" />
            <button
              onClick={onRotate}
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-all"
              title="Rotate 90°"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>
        )}

        {kind === 'pdf' && onPrintPdf && (
          <button
            onClick={onPrintPdf}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700/60 transition-all"
            title="Print PDF"
          >
            <Printer className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Print</span>
          </button>
        )}

        <button
          onClick={onOpenSystem}
          disabled={isOpenSystem}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs text-slate-200 border border-slate-700/60 transition-all"
          title="Open in System Default Application"
        >
          <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">Open</span>
        </button>

        <button
          onClick={onDownload}
          disabled={isDownloading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white shadow-lg shadow-indigo-600/20 transition-all"
          title="Save File Locally"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Save</span>
        </button>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all ml-1"
          title="Close Modal (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
