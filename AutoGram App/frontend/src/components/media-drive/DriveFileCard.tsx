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
import { getCachedThumb, forceRetryThumb, requestThumb } from '../../lib/thumbBatcher';
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

  const cached = canThumb ? getCachedThumb(folderId, file.id) : undefined;
  const [thumb, setThumb] = useState<string | null>(() =>
    cached === undefined ? null : cached
  );
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
    if (!canThumb) return;
    const hit = getCachedThumb(folderId, file.id);
    if (hit !== undefined) {
      setThumb(hit);
      setThumbLoading(false);
      setThumbFailed(!hit);
    } else {
      setThumb(null);
      setThumbFailed(false);
    }
  }, [canThumb, folderId, file.id, thumbQuality]);

  useEffect(() => {
    if (!creds || !canThumb || !visible) return;
    const controller = new AbortController();
    const hit = getCachedThumb(folderId, file.id);
    if (hit !== undefined) {
      setThumb(hit);
      setThumbLoading(false);
      setThumbFailed(!hit);
      // Soft-fail (null) may clear after cooldown — schedule one retry
      if (hit === null) {
        const t = window.setTimeout(() => {
          const again = getCachedThumb(folderId, file.id);
          if (again === undefined || again === null) {
            // Bypass softFailAt cache — force a fresh network request
            setThumbFailed(false);
            setThumbLoading(true);
            forceRetryThumb(creds, folderId, file.id);
            // forceRetryThumb enqueues a fresh request; result arrives via
            // the next render that finds the key in memCache / resolves the promise.
            // Schedule a follow-up read so the component updates once cache is warm.
            window.setTimeout(() => {
              if (controller.signal.aborted) return;
              const warm = getCachedThumb(folderId, file.id);
              if (warm !== undefined) {
                setThumb(warm);
                setThumbFailed(!warm);
                setThumbLoading(false);
              } else {
                // Still not ready — do a full requestThumb to get the promise
                void requestThumb(creds, folderId, file.id, {
                  priority: 'visible',
                  signal: controller.signal,
                }).then((url) => {
                  if (controller.signal.aborted) return;
                  setThumb(url);
                  setThumbFailed(!url);
                  setThumbLoading(false);
                });
              }
            }, 2000);
          }
        }, 4500);
        return () => {
          controller.abort();
          window.clearTimeout(t);
        };
      }
      return;
    }
    let cancelled = false;
    let retryTimer: number | undefined;
    setThumb(null);
    setThumbFailed(false);
    setThumbLoading(true);
    const load = (attempt: number) => {
      requestThumb(creds, folderId, file.id, {
        priority: 'visible',
        signal: controller.signal,
      })
        .then((url) => {
          if (cancelled) return;
          if (url) {
            setThumb(url);
            setThumbFailed(false);
            setThumbLoading(false);
            return;
          }
          // No url: retry a few times (session may still be warming)
          if (attempt < 3) {
            setThumbLoading(true);
            setThumbFailed(false);
            retryTimer = window.setTimeout(() => load(attempt + 1), 1200 + attempt * 800);
          } else {
            setThumb(null);
            setThumbFailed(true);
            setThumbLoading(false);
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 3) {
            retryTimer = window.setTimeout(() => load(attempt + 1), 1500);
          } else {
            setThumbFailed(true);
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
              draggable={false}
              loading="lazy"
              decoding="async"
              onError={() => {
                setImgError(true);
                setThumbFailed(true);
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
                <Loader2 size={26} className="spin" />
                <span>Memuat…</span>
              </div>
            ) : (
              <div className="td-thumb-placeholder">
                <FileTypeIcon file={file} size="lg" />
                {isVideo && !thumbFailed && <span className="td-placeholder-label">Video</span>}
                {isVideo && thumbFailed && <span className="td-placeholder-label">Tanpa preview</span>}
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

export const DriveFileCard = memo(DriveFileCardInner);
