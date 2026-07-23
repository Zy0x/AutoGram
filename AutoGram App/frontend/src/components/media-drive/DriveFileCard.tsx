import { memo, useEffect, useState } from 'react';
import { Eye, Download, Trash2, Check, Loader2, Play } from 'lucide-react';
import type { DriveCredentials } from '../../lib/driveApi';
import {
  canShowDriveThumb,
  driveFileDisplayName,
  driveFileDurationSeconds,
  formatDriveBytes,
  formatDriveDuration,
  formatDriveKindLabel,
  isVideoDriveFile,
  type DriveFile,
} from '../../lib/driveTypes';
import { usePointerDragPrime } from '../../lib/pointerDragPrime';
import {
  getCachedThumb,
  invalidateThumb,
  requestThumb,
} from '../../lib/thumbBatcher';
import { FileTypeIcon } from './FileTypeIcon';

type Props = {
  file: DriveFile;
  selected: boolean;
  /** True while this item (or multi-select group) is being dragged */
  isDragSource?: boolean;
  visible?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleSelection?: () => void;
  onPreview?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  onDragStartFile?: (e: React.DragEvent, file: DriveFile) => void;
  onDragEndFile?: (e: React.DragEvent) => void;
  /** Pointer-drag prime (WebView-safe path) — called once past move threshold */
  onMediaDragPrime?: (file: DriveFile, e: React.PointerEvent) => void;
  /** Prefetch first ~MB for faster open after scroll/hover */
  onWarmPreview?: () => void;
  creds: DriveCredentials | null;
  folderId: number | null;
  thumbQuality?: string;
};

function DriveFileCardInner({
  file,
  selected,
  isDragSource,
  visible = true,
  onClick,
  onDoubleClick,
  onContextMenu,
  onToggleSelection,
  onPreview,
  onDownload,
  onDelete,
  onDragStartFile,
  onDragEndFile,
  onMediaDragPrime,
  onWarmPreview,
  creds,
  folderId,
  thumbQuality,
}: Props) {
  const canThumb = canShowDriveThumb(file);
  const isVideo = isVideoDriveFile(file);
  const durationSecs = driveFileDurationSeconds(file);
  const durationLabel = formatDriveDuration(durationSecs);
  const kindLabel = formatDriveKindLabel(file);
  const displayName = driveFileDisplayName(file);
  
  let subLabel = '';
  if (file.icon_type === 'link') {
    try {
      const url = file.original_name || file.name || '';
      if (url.startsWith('http://') || url.startsWith('https://')) {
        subLabel = new URL(url).hostname;
      } else {
        subLabel = 'Tautan';
      }
    } catch {
      subLabel = 'Tautan';
    }
  } else {
    subLabel = formatDriveBytes(file.size);
    if (kindLabel) {
      subLabel += ` · ${kindLabel}`;
    }
  }

  const [dragging, setDragging] = useState(false);
  const [recentlyUploaded, setRecentlyUploaded] = useState(
    () => !!file.recently_uploaded_at && Date.now() - file.recently_uploaded_at < 4_000
  );
  const {
    suppressClick,
    movedPastThreshold,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    resetAfterDrag,
  } = usePointerDragPrime(file, onMediaDragPrime);

  // Pointer path: parent owns isDragSource. Never leave local `dragging` stuck
  // when parent clears mediaDragActive (onDragEnd never fires without HTML5).
  useEffect(() => {
    if (!isDragSource) {
      setDragging(false);
      resetAfterDrag();
    }
  }, [isDragSource, resetAfterDrag]);

  useEffect(() => {
    const at = Number(file.recently_uploaded_at || 0);
    const remaining = 4_000 - (Date.now() - at);
    if (!at || remaining <= 0) {
      setRecentlyUploaded(false);
      return;
    }
    setRecentlyUploaded(true);
    const timer = window.setTimeout(() => setRecentlyUploaded(false), remaining);
    return () => window.clearTimeout(timer);
  }, [file.id, file.recently_uploaded_at]);

  const inlineThumb =
    (file.thumb_data_url || file.thumbDataUrl || '') as string;
  const cached = canThumb ? getCachedThumb(folderId, file.id) : undefined;
  const [thumb, setThumb] = useState<string | null>(() => {
    if (cached) return cached;
    if (inlineThumb.startsWith('data:image/')) return inlineThumb;
    return null;
  });
  const [isPlaceholderImg, setIsPlaceholderImg] = useState<boolean>(() => {
    if (cached) return false;
    return inlineThumb.startsWith('data:image/');
  });
  const [thumbLoading, setThumbLoading] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
    if (!canThumb) {
      setThumb(null);
      setIsPlaceholderImg(false);
      setThumbLoading(false);
      return;
    }
    const hit = getCachedThumb(folderId, file.id);
    const inline = file.thumb_data_url || file.thumbDataUrl;
    if (hit) {
      setThumb(hit);
      setIsPlaceholderImg(false);
      setThumbLoading(false);
    } else if (inline && String(inline).startsWith('data:image/')) {
      setThumb(String(inline));
      setIsPlaceholderImg(true);
      setThumbLoading(thumbQuality !== 'saver');
    } else {
      setThumb(null);
      setIsPlaceholderImg(false);
      setThumbLoading(true);
    }
  }, [canThumb, folderId, file.id, thumbQuality, file.thumb_data_url, file.thumbDataUrl]);

  // Streaming / late fills: thumb may arrive after the initial request resolved null,
  // or a sharper frame may replace a stripped placeholder.
  useEffect(() => {
    if (!canThumb) return;
    const onReady = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { key?: string; url?: string; isPlaceholder?: boolean }
        | undefined;
      const hit = getCachedThumb(folderId, file.id);
      if (hit) {
        setThumb(hit);
        setIsPlaceholderImg(false);
        setThumbLoading(false);
        setImgError(false);
      } else if (detail?.url && detail?.isPlaceholder && thumbQuality !== 'saver') {
        // Transient blur placeholder: paint temporary preview without stopping loading state
        setThumb(detail.url);
        setIsPlaceholderImg(true);
      } else if (detail?.url && !detail?.isPlaceholder) {
        // High-resolution thumbnail arrived directly from worker streaming event
        setThumb(detail.url);
        setIsPlaceholderImg(false);
        setThumbLoading(false);
        setImgError(false);
      }
    };
    const onQuality = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { quality?: string; forceRefetch?: boolean }
        | undefined;
      const hit = getCachedThumb(folderId, file.id);
      // Saver hits are instant; seimbang/jelas must not keep painting hemat blur
      // if the hit is missing for the new quality key.
      if (hit && !detail?.forceRefetch) {
        setThumb(hit);
        setThumbLoading(false);
        return;
      }
      if (hit && detail?.quality === 'saver') {
        setThumb(hit);
        setThumbLoading(false);
        return;
      }
      // Keep previous frame until sharper arrives, but mark loading.
      if (visible && creds) {
        setThumbLoading(true);
        void requestThumb(creds, folderId, file.id, {
          priority: 'visible',
          bypassCache: detail?.forceRefetch === true && detail?.quality !== 'saver',
        }).then((url) => {
          if (url) {
            setThumb(url);
            setThumbLoading(false);
            setImgError(false);
          } else {
            setThumbLoading(false);
          }
        });
      }
    };
    window.addEventListener('autogram-thumb-ready', onReady);
    window.addEventListener('autogram-thumb-quality', onQuality);
    return () => {
      window.removeEventListener('autogram-thumb-ready', onReady);
      window.removeEventListener('autogram-thumb-quality', onQuality);
    };
  }, [canThumb, folderId, file.id, thumbQuality, visible, creds]);

  useEffect(() => {
    if (!creds || !canThumb || !visible) return;
    const controller = new AbortController();
    const hit = getCachedThumb(folderId, file.id);
    if (hit !== undefined && hit !== null) {
      setThumb(hit);
      setThumbLoading(false);
      return;
    }
    let cancelled = false;
    let retryTimer: number | undefined;
    // Spinner only when nothing is painted yet or when only saver stripped placeholder is painted for non-saver mode.
    const inlineNow = file.thumb_data_url || file.thumbDataUrl;
    const alreadyPainted = !!(
      getCachedThumb(folderId, file.id) ||
      (thumbQuality === 'saver' && inlineNow && String(inlineNow).startsWith('data:image/'))
    );
    setThumbLoading(!alreadyPainted);
    const MAX_RETRIES = 4;
    const load = (attempt: number) => {
      requestThumb(creds, folderId, file.id, {
        priority: 'visible',
        signal: controller.signal,
        bypassCache: attempt > 0,
      })
        .then((url) => {
          if (cancelled) return;
          if (url) {
            setThumb(url);
            setThumbLoading(false);
            setImgError(false);
            return;
          }
          if (attempt < MAX_RETRIES) {
            if (!alreadyPainted) setThumbLoading(true);
            const nextDelay = Math.min(200 + attempt * 250, 1200);
            retryTimer = window.setTimeout(() => load(attempt + 1), nextDelay);
          } else {
            setThumbLoading(false);
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < MAX_RETRIES) {
            setThumbLoading(true);
            const nextDelay = Math.min(1000 + attempt * 800, 4000);
            retryTimer = window.setTimeout(() => load(attempt + 1), nextDelay);
          } else {
            setThumbLoading(false);
          }
        });
    };
    load(0);
    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer != null) window.clearTimeout(retryTimer);
    };
  }, [creds, file.id, canThumb, folderId, visible, thumbQuality]);

  return (
    <div
      data-msg-id={file.id}
      data-drive-file="1"
      className={`td-file-card ${selected ? 'selected' : ''}${isVideo ? ' is-video' : ''}${
        dragging || isDragSource ? ' is-dragging' : ''
      }${thumb ? ' has-thumb' : ' no-thumb'}${recentlyUploaded ? ' is-new-upload' : ''}`}
      onMouseEnter={() => onWarmPreview?.()}
      onPointerEnter={() => onWarmPreview?.()}
      onMouseDown={(e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          e.preventDefault();
          try {
            window.getSelection()?.removeAllRanges();
          } catch {
            /* ignore */
          }
        }
      }}
      onClick={(e) => {
        if (suppressClick.current || movedPastThreshold.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
          movedPastThreshold.current = false;
          return;
        }
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          e.preventDefault();
          try {
            window.getSelection()?.removeAllRanges();
          } catch {
            /* ignore */
          }
        }
        onClick(e);
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        // Always block WebView/browser native menu so Drive tools show
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
      // Pointer-only internal DnD when prime handler is present (avoids HTML5 vs pointer war).
      // HTML5 drag kept only as rare fallback without prime (browser / tests).
      draggable={!onMediaDragPrime}
      onPointerDown={(e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          e.preventDefault();
        }
        onPointerDown(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        setDragging(false);
        onPointerCancel(e);
      }}
      onDragStart={(e) => {
        // Only used when draggable=true (no pointer prime)
        const t = e.target as HTMLElement;
        if (t.closest('button.td-select-check, button.td-file-act')) {
          e.preventDefault();
          return;
        }
        if (onMediaDragPrime) {
          e.preventDefault();
          return;
        }
        movedPastThreshold.current = true;
        suppressClick.current = true;
        setDragging(true);
        onDragStartFile?.(e, file);
      }}
      onDragEnd={(e) => {
        setDragging(false);
        resetAfterDrag();
        suppressClick.current = true;
        movedPastThreshold.current = false;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 120);
        onDragEndFile?.(e);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDoubleClick();
        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          onToggleSelection?.();
        }
      }}
      title={displayName}
    >
      <div className="td-file-card-inner">
        {recentlyUploaded && <span className="td-new-upload-badge">Baru diunggah</span>}
        {thumb && !imgError ? (
          <div className="td-file-thumb-full">
            <img
              src={thumb}
              alt=""
              className={isPlaceholderImg ? 'td-thumb-is-placeholder' : ''}
              draggable={false}
              // Visible grid cards should paint immediately; lazy + revoked blob
              // URLs left empty tiles after LRU eviction.
              loading="eager"
              decoding="async"
              onError={() => {
                setImgError(true);
                setThumb(null);
                // Blob may have been revoked by the LRU — drop cache and refetch.
                invalidateThumb(folderId, file.id, creds?.session);
                if (creds && canThumb && visible) {
                  setThumbLoading(true);
                  void requestThumb(creds, folderId, file.id, {
                    priority: 'visible',
                    bypassCache: true,
                  }).then((url) => {
                    if (url) {
                      setThumb(url);
                      setImgError(false);
                    }
                    setThumbLoading(false);
                  });
                }
              }}
            />
            <div className="td-file-thumb-grad" />
            {isVideo && (
              <span className="td-video-play" aria-hidden>
                <Play size={16} fill="currentColor" />
              </span>
            )}
          </div>
        ) : (
          <div className={`td-file-thumb-empty${isVideo ? ' is-video-empty' : ''}`}>
            {thumbLoading && canThumb ? (
              <div className="td-thumb-loading">
                <Loader2 size={24} className="spin" />
                <span>{isVideo ? 'Memuat Video…' : 'Memuat…'}</span>
              </div>
            ) : (
              <div className="td-thumb-placeholder">
                <FileTypeIcon file={file} size="lg" />
                {isVideo && (
                  <div className="td-video-auto-loading" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, opacity: 0.8, fontSize: '0.75rem' }}>
                    <Loader2 size={14} className="spin" />
                    <span>Memuat Video…</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className={`td-select-check ${selected ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelection?.();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={selected ? 'Deselect' : 'Select'}
        >
          {selected && <Check size={10} strokeWidth={3} />}
        </button>

        {/*
          Meta stack:
            [duration badge — top right, above name]
            name (full width, no cut by badge)
            size · type
        */}
        <div
          className={`td-file-card-meta ${thumb ? 'on-media' : 'on-empty'}${
            durationLabel ? ' has-duration' : ''
          }`}
        >
          {durationLabel ? (
            <span className="td-video-duration" title={`Durasi ${durationLabel}`}>
              {durationLabel}
            </span>
          ) : null}
          <div className="td-file-card-name" title={displayName}>
            {displayName}
          </div>
          <div className="td-file-card-sub" title={file.icon_type === 'link' ? (file.original_name || file.name) : undefined}>
            <span className="td-file-card-size">{subLabel}</span>
          </div>
        </div>

        <div className="td-file-card-actions">
          {onPreview && (
            <button
              type="button"
              className="td-file-act"
              title="Preview"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
            >
              <Eye size={12} />
            </button>
          )}
          {onDownload && (
            <button
              type="button"
              className="td-file-act ok"
              title="Download"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
            >
              <Download size={12} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className="td-file-act danger"
              title="Delete"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const DriveFileCard = memo(DriveFileCardInner, (prev, next) => {
  // Skip re-render when only parent identity objects churn during scroll.
  return (
    prev.file.id === next.file.id &&
    prev.file.size === next.file.size &&
    prev.file.name === next.file.name &&
    prev.file.icon_type === next.file.icon_type &&
    prev.file.recently_uploaded_at === next.file.recently_uploaded_at &&
    prev.selected === next.selected &&
    prev.isDragSource === next.isDragSource &&
    prev.visible === next.visible &&
    prev.folderId === next.folderId &&
    prev.thumbQuality === next.thumbQuality &&
    prev.creds?.session === next.creds?.session &&
    prev.onClick === next.onClick &&
    prev.onDoubleClick === next.onDoubleClick &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onToggleSelection === next.onToggleSelection &&
    prev.onPreview === next.onPreview &&
    prev.onDownload === next.onDownload &&
    prev.onDelete === next.onDelete &&
    prev.onDragStartFile === next.onDragStartFile &&
    prev.onDragEndFile === next.onDragEndFile &&
    prev.onMediaDragPrime === next.onMediaDragPrime &&
    prev.onWarmPreview === next.onWarmPreview
  );
});
