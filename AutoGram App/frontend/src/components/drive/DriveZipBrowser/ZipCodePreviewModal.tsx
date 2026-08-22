import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  RefreshCw,
  FileWarning,
  Zap,
  AlertCircle,
  Film,
  Music,
  Image as ImageIcon,
  FileText,
  FileCode,
  Lock,
} from 'lucide-react';
import { VSCodeCodeViewer } from '../../common/VSCodeCodeViewer';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import type { ZipEntry, ZipPreviewResult } from './zipUtils';

export type ZipCodePreviewModalProps = {
  entry: ZipEntry | null;
  entries?: ZipEntry[];
  preview: ZipPreviewResult | null;
  localUrl?: string | null;
  isLoading: boolean;
  error: string | null;
  onNavigate?: (entry: ZipEntry) => void;
  onExtract?: () => void;
  onClose: () => void;
};

export const ZipCodePreviewModal: React.FC<ZipCodePreviewModalProps> = ({
  entry,
  entries = [],
  preview,
  localUrl,
  isLoading,
  error,
  onNavigate,
  onExtract,
  onClose,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Image manipulation state
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Reset transforms on entry change
  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setPan({ x: 0, y: 0 });
    setIsFullscreen(false);
  }, [entry?.name]);

  const content = preview?.text || null;
  const mediaUrl = preview?.data_url || localUrl || null;
  const kind = preview?.kind || 'meta';

  // Navigation calculation
  const currentIndex = entry ? entries.findIndex((e) => e.name === entry.name) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < entries.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev && onNavigate && currentIndex > 0) {
      onNavigate(entries[currentIndex - 1]);
    }
  }, [currentIndex, entries, hasPrev, onNavigate]);

  const handleNext = useCallback(() => {
    if (hasNext && onNavigate && currentIndex >= 0 && currentIndex < entries.length - 1) {
      onNavigate(entries[currentIndex + 1]);
    }
  }, [currentIndex, entries, hasNext, onNavigate]);

  // Keyboard navigation & controls (Hook must run unconditionally)
  useEffect(() => {
    if (!entry) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (kind === 'image') {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setZoom((z) => Math.min(4, z + 0.25));
        } else if (e.key === '-') {
          e.preventDefault();
          setZoom((z) => Math.max(0.25, z - 0.25));
        } else if (e.key === '0') {
          e.preventDefault();
          setZoom(1);
          setRotation(0);
          setPan({ x: 0, y: 0 });
        } else if (e.key.toLowerCase() === 'r') {
          e.preventDefault();
          setRotation((r) => (r + 90) % 360);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entry, handleNext, handlePrev, kind, onClose]);

  const handleCopy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  // Image dragging handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // All hooks have been called. Now we can safely return null if no entry is selected.
  if (!entry) return null;

  const imageTransformStyle: React.CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
    transition: isDragging ? 'none' : 'transform 0.15s ease-out',
    maxHeight: '100%',
    maxWidth: '100%',
    objectFit: 'contain',
  };

  return (
    <div
      className={`drive-preview-overlay dzb-modal-overlay${isFullscreen ? ' is-fs' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={entry.name}
    >
      <div
        className={`drive-preview-modal dzb-preview-modal${isFullscreen ? ' is-fullscreen' : ''}`}
      >
        {/* Unified Drive Preview Header Toolbar */}
        <header className="drive-preview-header">
          <div className="drive-preview-title" title={entry.name}>
            <span className="font-semibold text-sm text-slate-100">{entry.name}</span>
            <span className="text-xs text-slate-400 font-mono ml-2">
              ({formatDriveBytes(entry.size)})
            </span>
            {entries.length > 1 && currentIndex >= 0 && (
              <span className="text-xs text-indigo-400 font-mono ml-2">
                [{currentIndex + 1} / {entries.length}]
              </span>
            )}
            {entry.encrypted && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-400 font-medium ml-2 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                <Lock size={11} />
                <span>{t('speedtest.zip_tag_encrypted')}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Prev / Next Navigation */}
            {entries.length > 1 && (
              <>
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={handlePrev}
                  className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  title={t('speedtest.prev_file_tooltip')}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={handleNext}
                  className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  title={t('speedtest.next_file_tooltip')}
                >
                  <ChevronRight size={18} />
                </button>
                <div className="w-px h-4 bg-slate-700/60 mx-0.5" />
              </>
            )}

            {/* Copy Button (for Code / Text) */}
            {content && (
              <button
                type="button"
                onClick={handleCopy}
                className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors"
                title={t(copied ? 'speedtest.zip_btn_copied' : 'speedtest.zip_btn_copy')}
              >
                {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
              </button>
            )}

            {/* Extract Entry Button */}
            {onExtract && (
              <button
                type="button"
                onClick={onExtract}
                className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors"
                title={t('speedtest.zip_extract_entry')}
              >
                <Download size={16} />
              </button>
            )}

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={() => setIsFullscreen((fs) => !fs)}
              className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors"
              title={
                isFullscreen
                  ? t('speedtest.preview_fullscreen_exit')
                  : t('speedtest.preview_fullscreen_enter')
              }
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-red-500/20 hover:text-red-300 ml-1 transition-colors"
              title={t('speedtest.close_esc_tooltip')}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Center Stage & Media Viewer */}
        <div className="drive-preview-body dzb-preview-body">
          {isLoading ? (
            <div className="dzb-preview-loading-card">
              <div className="dzb-dual-ring-wrap">
                <div className="dzb-dual-ring-spinner" />
                <div className="dzb-loading-icon-center text-indigo-400">
                  {kind === 'video' ? (
                    <Film size={22} />
                  ) : kind === 'audio' ? (
                    <Music size={22} />
                  ) : kind === 'image' ? (
                    <ImageIcon size={22} />
                  ) : kind === 'text' ? (
                    <FileCode size={22} />
                  ) : kind === 'pdf' ? (
                    <FileText size={22} />
                  ) : (
                    <Zap size={22} />
                  )}
                </div>
              </div>

              <div className="dzb-loading-title-box">
                <h4 className="dzb-loading-title">{t('speedtest.zip_reading_entry')}</h4>
                <p className="dzb-loading-sub">{t('speedtest.zip_sparse_reading_dots')}</p>
              </div>

              <div className="dzb-loading-shimmer-bar">
                <div className="dzb-loading-shimmer-thumb" />
              </div>

              <div className="dzb-loading-badge">
                <Zap size={12} className="text-amber-400" />
                <span>{t('speedtest.zip_sparse_direct_decrypt')}</span>
              </div>
            </div>
          ) : error ? (
            <div className="dzb-preview-error-card">
              <div className="dzb-error-icon-wrap">
                <AlertCircle size={36} className="text-rose-400" />
              </div>
              <h4 className="dzb-error-title">{t('speedtest.zip_thumbnail_failed')}</h4>
              <p className="dzb-error-msg">{error}</p>
            </div>
          ) : kind === 'text' && content != null ? (
            <div className="dzb-preview-code-wrap">
              <VSCodeCodeViewer text={content} name={entry.name} />
            </div>
          ) : kind === 'image' && mediaUrl ? (
            <div
              className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden select-none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div className="flex-1 w-full h-full flex items-center justify-center p-4">
                <img
                  src={mediaUrl}
                  alt={entry.name}
                  style={imageTransformStyle}
                  className={`max-w-full max-h-full rounded-md shadow-2xl ${
                    zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
                  }`}
                  draggable={false}
                />
              </div>

              {/* Image Floating Toolbar */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl px-3 py-1.5 flex items-center gap-2 shadow-2xl z-20">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                  className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
                  title={t('speedtest.zoom_out_tooltip')}
                >
                  <ZoomOut size={16} />
                </button>
                <span className="text-xs font-mono text-slate-200 min-w-[40px] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                  className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
                  title={t('speedtest.zoom_in_tooltip')}
                >
                  <ZoomIn size={16} />
                </button>

                <div className="w-px h-4 bg-slate-800 mx-1" />

                <button
                  type="button"
                  onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
                  className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
                  title={t('speedtest.rotate_left_tooltip')}
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
                  title={t('speedtest.rotate_right_tooltip')}
                >
                  <RotateCw size={16} />
                </button>

                <div className="w-px h-4 bg-slate-800 mx-1" />

                <button
                  type="button"
                  onClick={() => setFlipH((f) => !f)}
                  className={`p-1.5 rounded-lg hover:bg-slate-800 ${
                    flipH ? 'text-indigo-400 bg-indigo-950/60' : 'text-slate-300 hover:text-white'
                  }`}
                  title={t('speedtest.flip_h_tooltip')}
                >
                  <FlipHorizontal size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setFlipV((f) => !f)}
                  className={`p-1.5 rounded-lg hover:bg-slate-800 ${
                    flipV ? 'text-indigo-400 bg-indigo-950/60' : 'text-slate-300 hover:text-white'
                  }`}
                  title={t('speedtest.flip_v_tooltip')}
                >
                  <FlipVertical size={16} />
                </button>

                <div className="w-px h-4 bg-slate-800 mx-1" />

                <button
                  type="button"
                  onClick={() => {
                    setZoom(1);
                    setRotation(0);
                    setFlipH(false);
                    setFlipV(false);
                    setPan({ x: 0, y: 0 });
                  }}
                  className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800"
                  title={t('speedtest.label_rotate_reset')}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>
          ) : kind === 'video' && mediaUrl ? (
            <div className="dzb-preview-video-wrap">
              <video
                className="dzb-preview-video"
                src={mediaUrl}
                controls
                autoPlay
                preload="metadata"
                playsInline
              />
            </div>
          ) : kind === 'audio' && mediaUrl ? (
            <div className="dzb-preview-audio-card">
              <div className="dzb-audio-disc-wrap">
                <div className="dzb-audio-disc">
                  <div className="dzb-audio-disc-center">
                    <Music size={24} className="text-emerald-400" />
                  </div>
                </div>
              </div>

              <div className="dzb-audio-details">
                <h4 className="dzb-audio-name" title={entry.name}>
                  {entry.name}
                </h4>
                <span className="dzb-audio-size">{formatDriveBytes(entry.size)}</span>
              </div>

              <div className="dzb-audio-player-box">
                <audio
                  className="dzb-preview-audio-element"
                  src={mediaUrl}
                  controls
                  autoPlay
                  preload="metadata"
                />
              </div>
            </div>
          ) : kind === 'pdf' && mediaUrl ? (
            <div className="dzb-preview-pdf-wrap">
              <iframe className="dzb-preview-pdf" src={mediaUrl} title={entry.name} />
            </div>
          ) : (
            <div className="dzb-preview-binary-card">
              <div className="dzb-binary-icon-wrap">
                <FileWarning size={48} className="text-amber-400" />
              </div>
              <h3 className="dzb-binary-title">{t('speedtest.zip_binary_title')}</h3>
              <p className="dzb-binary-desc">{t('speedtest.zip_binary_desc')}</p>
              <div className="dzb-binary-meta">
                <span>{formatDriveBytes(entry.size)}</span>
              </div>
              {onExtract && (
                <button
                  type="button"
                  onClick={onExtract}
                  className="dzb-btn-primary dzb-binary-extract-btn"
                >
                  <Download size={16} />
                  <span>{t('speedtest.zip_preview_extract_btn')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
