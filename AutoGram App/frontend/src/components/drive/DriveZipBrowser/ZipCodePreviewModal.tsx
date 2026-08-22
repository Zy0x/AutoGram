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
  Shrink,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  RefreshCw,
  Search,
  PictureInPicture2,
  Info,
  FileWarning,
  Zap,
  AlertCircle,
  Film,
  Music,
  Image as ImageIcon,
  FileText,
  FileCode,
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
  const [showInfo, setShowInfo] = useState(false);
  const [isMagnifierMode, setIsMagnifierMode] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  // Image manipulation state
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Reset transforms & dimensions on entry change
  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setPan({ x: 0, y: 0 });
    setIsFullscreen(false);
    setShowInfo(false);
    setIsMagnifierMode(false);
    setDimensions(null);
  }, [entry?.name]);

  const content = preview?.text || null;
  const mediaUrl = preview?.data_url || localUrl || null;
  const kind = preview?.kind || 'meta';

  const ext = entry?.name.split('.').pop()?.toLowerCase() || '';
  const isImage = kind === 'image';
  const isVideo = kind === 'video';
  const isAudio = kind === 'audio';
  const isText = kind === 'text';
  const isPdf = kind === 'pdf';
  const mediaKind = isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : isText ? 'text' : isPdf ? 'pdf' : 'other';

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

  // Keyboard navigation & controls (unconditionally declared)
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
      } else if (isImage) {
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
  }, [entry, handleNext, handlePrev, isImage, onClose]);

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

  // Guard after all hooks run
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
      className={`drive-preview-overlay${isFullscreen ? ' is-fs' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={entry.name}
      onClick={onClose}
    >
      <div
        className={`drive-preview-modal${isFullscreen ? ' is-fullscreen' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Exact Drive Preview Header Toolbar Layout */}
        <header className="drive-preview-header font-sans">
          {/* Row A: Title & Meta */}
          <div className="drive-preview-title">
            <strong title={entry.name}>{entry.name}</strong>
            <span
              className="drive-muted"
              title={`${formatDriveBytes(entry.size)}${
                dimensions ? ` · ${dimensions.width}×${dimensions.height}px` : ''
              }${ext ? ` · ${ext}` : ''}${
                entries.length > 1 && currentIndex >= 0 ? ` · [${currentIndex + 1} / ${entries.length}]` : ''
              }${entry.encrypted ? ` · 🔒 ${t('speedtest.zip_tag_encrypted')}` : ''}`}
            >
              {formatDriveBytes(entry.size)}
              {dimensions ? ` · ${dimensions.width}×${dimensions.height}px` : ''}
              {ext ? ` · ${ext}` : ''}
              {entries.length > 1 && currentIndex >= 0 ? ` · [${currentIndex + 1} / ${entries.length}]` : ''}
              {entry.encrypted ? ` · 🔒 ${t('speedtest.zip_tag_encrypted')}` : ''}
            </span>
          </div>

          {/* Row B: Nav Toolbar */}
          <div className="drive-preview-nav" role="toolbar" aria-label={t('speedtest.nav_aria')}>
            {/* Prev / Next Navigation */}
            {entries.length > 1 && (
              <>
                <button
                  type="button"
                  className="td-icon-btn"
                  disabled={!hasPrev}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePrev();
                  }}
                  title={hasPrev ? t('speedtest.preview_prev_file') : t('speedtest.preview_no_prev')}
                  aria-label={t('speedtest.prev_aria')}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  className="td-icon-btn"
                  disabled={!hasNext}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNext();
                  }}
                  title={hasNext ? t('speedtest.preview_next_file') : t('speedtest.preview_no_next')}
                  aria-label={t('speedtest.next_aria')}
                >
                  <ChevronRight size={18} />
                </button>
              </>
            )}

            {/* Extract Entry Button */}
            {onExtract && (
              <button
                type="button"
                className="td-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onExtract();
                }}
                title={t('speedtest.zip_extract_entry')}
                aria-label={t('speedtest.zip_extract_entry')}
              >
                <Download size={16} />
              </button>
            )}

            {/* Fullscreen Toggle */}
            <button
              type="button"
              className="td-icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                setIsFullscreen((fs) => !fs);
              }}
              title={
                isFullscreen
                  ? t('speedtest.preview_fullscreen_exit')
                  : t('speedtest.preview_fullscreen_enter')
              }
              aria-label={t('speedtest.fullscreen')}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>

          {/* Row A: Close Button */}
          <button
            type="button"
            className="td-icon-btn drive-preview-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title={t('speedtest.close_esc_tooltip')}
            aria-label={t('speedtest.preview_close_btn')}
          >
            <X size={18} />
          </button>
        </header>

        {/* Full Adaptive Labeled Secondary Toolbar */}
        <div
          className={`drive-preview-toolbar is-${mediaKind}`}
          role="toolbar"
          aria-label={
            isImage
              ? t('speedtest.label_zoom')
              : isVideo
              ? t('speedtest.label_video')
              : t('speedtest.nav_aria')
          }
          data-media-kind={mediaKind}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="drive-preview-tools">
            {/* ZOOM Group (for Image & Video) */}
            {(isImage || isVideo) && (
              <div className="drive-tool-group" role="group" aria-label={t('speedtest.label_zoom')}>
                <span className="drive-tool-group-label">{t('speedtest.label_zoom')}</span>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t('speedtest.zoom_out_tooltip')}
                  disabled={zoom <= 0.25}
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                >
                  <ZoomOut size={15} />
                  <span className="drive-tool-btn-label">{t('speedtest.label_zoom_out')}</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn drive-tool-btn-value"
                  title={t('speedtest.tooltip_zoom_reset')}
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  <Shrink size={14} />
                  <span className="drive-tool-btn-label strong">{Math.round(zoom * 100)}%</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t('speedtest.zoom_in_tooltip')}
                  disabled={zoom >= 4}
                  onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                >
                  <ZoomIn size={15} />
                  <span className="drive-tool-btn-label">{t('speedtest.label_zoom_in')}</span>
                </button>
                {isImage && (
                  <button
                    type="button"
                    className={`drive-tool-btn${isMagnifierMode ? ' is-on' : ''}`}
                    title={t('speedtest.tooltip_magnifier')}
                    onClick={() => {
                      setIsMagnifierMode((m) => !m);
                      if (!isMagnifierMode && zoom <= 1) {
                        setZoom(2);
                      }
                    }}
                    aria-pressed={isMagnifierMode}
                  >
                    <Search size={15} />
                    <span className="drive-tool-btn-label">{t('speedtest.label_magnifier')}</span>
                  </button>
                )}
              </div>
            )}

            {/* ROTATE Group (for Image & Video) */}
            {(isImage || isVideo) && (
              <div className="drive-tool-group" role="group" aria-label={t('speedtest.label_rotate')}>
                <span className="drive-tool-group-label">{t('speedtest.label_rotate')}</span>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t('speedtest.tooltip_rotate_left')}
                  onClick={() => setRotation((r) => (r + 270) % 360)}
                >
                  <RotateCcw size={15} />
                  <span className="drive-tool-btn-label">{t('speedtest.label_left')}</span>
                </button>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t('speedtest.tooltip_rotate_right')}
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                >
                  <RotateCw size={15} />
                  <span className="drive-tool-btn-label">{t('speedtest.label_right')}</span>
                </button>
                <button
                  type="button"
                  className={`drive-tool-btn${flipV ? ' is-on' : ''}`}
                  title={t('speedtest.tooltip_flip_v')}
                  onClick={() => setFlipV((v) => !v)}
                >
                  <FlipVertical size={15} />
                  <span className="drive-tool-btn-label">{t('speedtest.label_flip_v')}</span>
                </button>
                <button
                  type="button"
                  className={`drive-tool-btn${flipH ? ' is-on' : ''}`}
                  title={t('speedtest.tooltip_flip_h')}
                  onClick={() => setFlipH((h) => !h)}
                >
                  <FlipHorizontal size={15} />
                  <span className="drive-tool-btn-label">{t('speedtest.label_flip')}</span>
                </button>
                {(rotation !== 0 || flipH || flipV) && (
                  <button
                    type="button"
                    className="drive-tool-btn"
                    title={t('speedtest.tooltip_rotate_reset')}
                    onClick={() => {
                      setRotation(0);
                      setFlipH(false);
                      setFlipV(false);
                    }}
                  >
                    <RefreshCw size={15} />
                    <span className="drive-tool-btn-label">{t('speedtest.label_rotate_reset')}</span>
                  </button>
                )}
              </div>
            )}

            {/* VIDEO Group */}
            {isVideo && (
              <div className="drive-tool-group" role="group" aria-label={t('speedtest.label_video')}>
                <span className="drive-tool-group-label">{t('speedtest.label_video')}</span>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t('speedtest.preview_pip_hint')}
                  onClick={() => {
                    const vid = document.querySelector('.dzb-preview-video') as HTMLVideoElement | null;
                    if (vid) {
                      if (document.pictureInPictureElement) {
                        void document.exitPictureInPicture();
                      } else if (vid.requestPictureInPicture) {
                        void vid.requestPictureInPicture();
                      }
                    }
                  }}
                >
                  <PictureInPicture2 size={15} />
                  <span className="drive-tool-btn-label">{t('speedtest.label_pip')}</span>
                </button>
              </div>
            )}

            {/* DOCUMENT / CODE Group */}
            {isText && content && (
              <div className="drive-tool-group" role="group" aria-label={t('speedtest.label_open_doc')}>
                <span className="drive-tool-group-label">{t('speedtest.label_open')}</span>
                <button
                  type="button"
                  className="drive-tool-btn"
                  title={t('speedtest.copy_text')}
                  onClick={() => void handleCopy()}
                >
                  {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
                  <span className="drive-tool-btn-label">{t('speedtest.label_copy')}</span>
                </button>
              </div>
            )}

            {/* MORE Group */}
            <div className="drive-tool-group" role="group" aria-label={t('speedtest.label_other')}>
              <span className="drive-tool-group-label">{t('speedtest.label_other')}</span>
              <button
                type="button"
                className="drive-tool-btn"
                title={t('speedtest.reload_preview')}
                onClick={() => {
                  if (entry && onNavigate) {
                    onNavigate(entry);
                  }
                }}
              >
                <RefreshCw size={15} />
                <span className="drive-tool-btn-label">{isLoading ? t('speedtest.label_loading') : t('speedtest.label_load')}</span>
              </button>
              <button
                type="button"
                className={`drive-tool-btn${showInfo ? ' is-on' : ''}`}
                title={t('speedtest.file_detail_tooltip')}
                onClick={() => setShowInfo((s) => !s)}
              >
                <Info size={15} />
                <span className="drive-tool-btn-label">{t('speedtest.label_info')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Center Stage & Media Viewer */}
        <div className="drive-preview-body">
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
                  onLoad={(e) => {
                    setDimensions({
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    });
                  }}
                  style={imageTransformStyle}
                  className={`max-w-full max-h-full rounded-md shadow-2xl ${
                    zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
                  }`}
                  draggable={false}
                />
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
                onLoadedMetadata={(e) => {
                  setDimensions({
                    width: e.currentTarget.videoWidth,
                    height: e.currentTarget.videoHeight,
                  });
                }}
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

          {/* Info Side Dialog Panel */}
          {showInfo && (
            <div
              className="drive-preview-info"
              role="dialog"
              aria-label={t('speedtest.detail_aria')}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="drive-preview-info-head">
                <strong className="drive-preview-info-title">{t('speedtest.file_detail_title')}</strong>
                <button
                  type="button"
                  className="td-icon-btn drive-preview-info-close"
                  title={t('speedtest.close_info')}
                  aria-label={t('speedtest.close_info')}
                  onClick={() => setShowInfo(false)}
                >
                  <X size={14} />
                </button>
              </div>
              <div>
                <strong>{t('speedtest.col_name')}</strong> {entry.name}
              </div>
              {dimensions && (
                <div>
                  <strong>{t('speedtest.dimensions_label')}</strong> {dimensions.width} {t('ui.generated.text_67fba2f')} {dimensions.height} {t('ui.generated.px_07a65dd')}
                </div>
              )}
              <div>
                <strong>{t('speedtest.size_label')}</strong> {formatDriveBytes(entry.size)}
              </div>
              <div>
                <strong>{t('speedtest.type_label')}</strong> {kind}
              </div>
              {entry.encrypted && (
                <div>
                  <strong>{t('speedtest.zip_tag_encrypted')}</strong> 🔒 {t('speedtest.zip_tag_encrypted')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
