import { useTranslation } from 'react-i18next';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Download, Trash2, Check, Loader2, Play, Scissors, Copy, ImageOff } from 'lucide-react';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import { resolveDriveEngineLocation } from '../../../lib/telegram/driveApi';
import {
  canShowDriveThumb,
  driveFileDisplayName,
  driveFileDurationSeconds,
  formatDriveBytes,
  formatDriveDuration,
  formatDriveKindLabel,
  isVideoDriveFile,
  isImageDriveFile,
  type DriveFile,
} from '../../../lib/telegram/driveTypes';
import { usePointerDragPrime, useDriveClipboard } from '../../../lib/telegram';
import {
  getCachedThumb,
  getCachedSaverThumb,
  buildThumbCacheKey,
  invalidateThumb,
  requestThumb,
} from '../../../lib/media/thumbBatcher';
import { FileTypeIcon } from './FileTypeIcon';
import { VideoCanvasThumbnailCapturer } from './VideoCanvasThumbnailCapturer';
import { ImageCanvasThumbnailCapturer } from './ImageCanvasThumbnailCapturer';

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
  contextTopicId?: number | null;
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
  contextTopicId = null,
  thumbQuality,
}: Props) {
  const { t } = useTranslation();
  const canThumb = canShowDriveThumb(file);
  const isVideo = isVideoDriveFile(file);
  const isImage = isImageDriveFile(file);
  const durationSecs = driveFileDurationSeconds(file);
  const durationLabel = formatDriveDuration(durationSecs);
  const kindLabel = formatDriveKindLabel(file);
  const displayName = driveFileDisplayName(file);
  const linkUrls = file.icon_type === 'link'
    ? (file.link_urls?.length ? file.link_urls : [file.original_name || file.name]).filter(Boolean) as string[]
    : [];
  const linkHosts = linkUrls.map((url) => {
    try {
      return new URL(url).hostname.replace(/^www\./i, '');
    } catch {
      return url;
    }
  });

  // `drive_format` from older link/text indexes can contain the entire message
  // body. Format badges must always be structural labels, never user text.
  const rawDriveFormat = String(file.drive_format || '').trim();
  const drFmt = (
    file.icon_type === 'link' || file.icon_type === 'text'
      ? (file.file_ext || kindLabel || 'URL')
      : ((/^https?:\/\//i.test(rawDriveFormat) ? '' : rawDriveFormat) || file.file_ext || kindLabel || '')
  ).toUpperCase();
  let subLabel = '';
  if (file.icon_type === 'link') {
    subLabel = linkUrls.length > 1
      ? t('drive.link_preview_multiple', { count: linkUrls.length })
      : (linkHosts[0] || t('drive.view_links'));
  } else {
    subLabel = formatDriveBytes(file.size);
  }

  const [dragging, setDragging] = useState(false);
  const clipboard = useDriveClipboard();
  const isCut = clipboard?.mode === 'cut' && clipboard.messageIds.includes(file.id);
  const isCopy = clipboard?.mode === 'copy' && clipboard.messageIds.includes(file.id);
  const [recentlyUploaded, setRecentlyUploaded] = useState(
    () => !!file.recently_uploaded_at && Date.now() - file.recently_uploaded_at < 4_000
  );

  const handleLongPress = useCallback(
    (_f: DriveFile, coords: { x: number; y: number }) => {
      onContextMenu({
        clientX: coords.x,
        clientY: coords.y,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    },
    [onContextMenu]
  );

  const {
    suppressClick,
    movedPastThreshold,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    resetAfterDrag,
  } = usePointerDragPrime(file, onMediaDragPrime, handleLongPress);

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
  // The mounted explorer context is authoritative. A stale row must never be
  // allowed to redirect a thumbnail request into another account/location.
  const itemPeerId = folderId != null && folderId !== 0
    ? String(resolveDriveEngineLocation(folderId)?.storagePeerId ?? folderId)
    : 'me';
  const itemTopicId = contextTopicId;
  const itemLocationType = itemPeerId === 'me' ? 'saved_messages' : 'group';
  const thumbLocator = { peerId: itemPeerId, topicId: itemTopicId };
  const cached = canThumb ? getCachedThumb(folderId, file.id, thumbLocator) : undefined;
  // Saver fallback: blurred placeholder shown immediately in balanced/sharp mode
  // while the higher-quality thumb is being fetched (mirrors Telegram progressive loading).
  const saverFallback = (!cached && !inlineThumb.startsWith('data:image/') && canThumb)
    ? getCachedSaverThumb(folderId, file.id, creds?.session, thumbLocator)
    : null;
  const [thumb, setThumb] = useState<string | null>(() => {
    if (cached) return cached;
    if (inlineThumb.startsWith('data:image/')) return inlineThumb;
    if (saverFallback) return saverFallback;
    return null;
  });
  const [isPlaceholderImg, setIsPlaceholderImg] = useState<boolean>(() => {
    if (thumbQuality === 'saver') return false; // In saver mode, inline/saver thumb is the final thumb
    if (cached) return false;
    if (inlineThumb.startsWith('data:image/')) return true;
    if (saverFallback) return true; // subtle placeholder until balanced/sharp arrives
    return false;
  });
  const [thumbLoading, setThumbLoading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const retriedRef = useRef(false);

  useEffect(() => {
    return () => {
      // Memory Hygiene: Clean up thumb state on unmount so Blink GC immediately releases image handles
      setThumb(null);
      setIsPlaceholderImg(false);
      setThumbLoading(false);
    };
  }, []);

  useEffect(() => {
    setImgError(false);
    retriedRef.current = false;
    if (!canThumb) {
      setThumb(null);
      setIsPlaceholderImg(false);
      setThumbLoading(false);
      return;
    }
    const hit = getCachedThumb(folderId, file.id, thumbLocator);
    const inline = file.thumb_data_url || file.thumbDataUrl;

    if (thumbQuality === 'saver') {
      const src = hit || (inline && String(inline).startsWith('data:image/') ? String(inline) : null) || saverFallback;
      setThumb(src);
      setIsPlaceholderImg(false);
      setThumbLoading(false);
      return;
    }

    if (hit) {
      setThumb(hit);
      setIsPlaceholderImg(false);
      setThumbLoading(false);
    } else if (inline && String(inline).startsWith('data:image/')) {
      setThumb(String(inline));
      setIsPlaceholderImg(true);
      setThumbLoading(true);
    } else {
      const saver = getCachedSaverThumb(folderId, file.id, creds?.session, thumbLocator);
      if (saver) {
        setThumb(saver);
        setIsPlaceholderImg(true);
        setThumbLoading(true);
      } else {
        setThumb(null);
        setIsPlaceholderImg(false);
        setThumbLoading(true);
      }
    }

    if (!hit && visible && canThumb && creds) {
      void requestThumb(creds, folderId, file.id, {
        priority: 'visible',
        peerId: itemPeerId,
        topicId: itemTopicId,
        locationType: itemLocationType,
      }).then((url) => {
        if (url) {
          setThumb(url);
          setIsPlaceholderImg(false);
          setThumbLoading(false);
          setImgError(false);
        } else {
          setThumbLoading(false);
        }
      }).catch(() => {
        setThumbLoading(false);
      });
    }
  }, [canThumb, folderId, file.id, file.peer_id, file.topic_id, creds?.session, thumbQuality, file.thumb_data_url, file.thumbDataUrl, visible]);

  // Safety Timeout: Prevent permanent stuck spinner when thumb request returns null or is evicted
  useEffect(() => {
    if (!thumbLoading) return;
    const timer = setTimeout(() => {
      setThumbLoading(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, [thumbLoading]);

  // Streaming / late fills: thumb may arrive after the initial request resolved null,
  // or a sharper frame may replace a stripped placeholder.
  useEffect(() => {
    if (!canThumb) return;

    const onReady = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { key?: string; url?: string; isPlaceholder?: boolean }
        | undefined;
      if (!detail?.key || !detail?.url) return;
      if (!creds?.session) return;
      const expectedKey = buildThumbCacheKey(
        folderId,
        file.id,
        (thumbQuality as 'saver' | 'balanced' | 'sharp') || 'balanced',
        creds.session,
        itemPeerId,
        itemTopicId
      );
      if (detail.key !== expectedKey) return;

      const hit = getCachedThumb(folderId, file.id, thumbLocator);
      if (hit) {
        setThumb(hit);
        setIsPlaceholderImg(false);
        setThumbLoading(false);
        setImgError(false);
      } else if (detail.isPlaceholder && thumbQuality !== 'saver') {
        // Transient blur placeholder: paint temporary preview without stopping loading state
        setThumb(detail.url);
        setIsPlaceholderImg(true);
      } else if (!detail.isPlaceholder) {
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
      const hit = getCachedThumb(folderId, file.id, thumbLocator);
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
      // If switching FROM saver to balanced/sharp: show saver blur as placeholder.
      if (!thumb) {
        const saver = detail?.quality !== 'saver'
          ? getCachedSaverThumb(folderId, file.id, creds?.session, thumbLocator)
          : null;
        if (saver) {
          setThumb(saver);
          setIsPlaceholderImg(true);
        }
      }
      if (visible && creds) {
        setThumbLoading(true);
      }
    };
    const onCacheCleared = () => {
      setThumb(null);
      setImgError(false);
      setIsPlaceholderImg(false);
      if (visible && creds && canThumb) {
        setThumbLoading(true);
      }
    };
    window.addEventListener('autogram-thumb-ready', onReady);
    window.addEventListener('autogram-thumb-quality', onQuality);
    window.addEventListener('autogram-cache-cleared', onCacheCleared);
    return () => {
      window.removeEventListener('autogram-thumb-ready', onReady);
      window.removeEventListener('autogram-thumb-quality', onQuality);
      window.removeEventListener('autogram-cache-cleared', onCacheCleared);
    };
  }, [canThumb, folderId, file.id, file.peer_id, file.topic_id, thumbQuality, visible, creds]);

  return (
    <div
      data-msg-id={file.id}
      data-drive-file="1"
      data-can-thumb={canThumb ? '1' : '0'}
      data-session={creds?.session || ''}
      data-peer-id={itemPeerId}
      data-topic-id={itemTopicId ?? 'all'}
      className={`td-file-card ${selected ? 'selected' : ''}${isVideo ? ' is-video' : ''}${
        dragging || isDragSource ? ' is-dragging' : ''
      }${thumb ? ' has-thumb' : ' no-thumb'}${recentlyUploaded ? ' is-new-upload' : ''}${
        isCut ? ' is-clipboard-cut' : ''
      }${isCopy ? ' is-clipboard-copy' : ''}`}
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
      onPointerDown={onPointerDown}
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
        {recentlyUploaded && <span className="td-new-upload-badge">{t('drive.badge_recently_uploaded')}</span>}
        {isCut && (
          <span className="td-clipboard-badge is-cut" title={t('drive.clipboard_cut_badge')}>
            <Scissors size={10} />
            <span>{t('drive.clipboard_cut_tag')}</span>
          </span>
        )}
        {isCopy && (
          <span className="td-clipboard-badge is-copy" title={t('drive.clipboard_copy_badge')}>
            <Copy size={10} />
            <span>{t('drive.clipboard_copy_tag')}</span>
          </span>
        )}
        {(() => {
          const tgCat = (file.telegram_category || (file.as_document ? 'file' : file.icon_type === 'image' || file.icon_type === 'video' ? 'media' : file.icon_type || 'file')).toLowerCase();
          return (
            <div className="td-file-perspective-badges">
              <span className={`td-tag-badge tg-${tgCat}`}>
                {tgCat.toUpperCase()}
              </span>
            </div>
          );
        })()}
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
                setThumb(null);
                setIsPlaceholderImg(false);
                // Blob may have been revoked by the LRU — drop cache and refetch once
                invalidateThumb(folderId, file.id, creds?.session, thumbLocator);
                if (creds && canThumb && visible && !retriedRef.current) {
                  retriedRef.current = true;
                  setThumbLoading(true);
                  void requestThumb(creds, folderId, file.id, {
                    priority: 'visible',
                    bypassCache: true,
                    peerId: itemPeerId,
                    topicId: itemTopicId,
                    locationType: itemLocationType,
                  }).then((url: any) => {
                    if (url) {
                      setThumb(url);
                      setImgError(false);
                    } else {
                      setImgError(true);
                    }
                    setThumbLoading(false);
                  }).catch(() => {
                    setImgError(true);
                    setThumbLoading(false);
                  });
                } else {
                  setImgError(true);
                  setThumbLoading(false);
                }
              }}
            />
            <div className="td-file-thumb-grad" />
            {file.icon_type === 'link' && onPreview && (
              <button
                type="button"
                className="td-link-media-preview-btn"
                title={t('drive.preview_link_media')}
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview();
                }}
                aria-label={t('drive.preview_link_media')}
              >
                <Eye size={12} />
                <span>{t('drive.preview_media_label')}</span>
              </button>
            )}
            {isVideo && (
              <span className="td-video-play" aria-hidden>
                <Play size={16} fill="currentColor" />
              </span>
            )}
          </div>
        ) : (
          <div
            className={`td-file-thumb-empty${isVideo ? ' is-video-empty' : ''}${imgError ? ' is-corrupted' : ''}`}
            style={{
              background: imgError
                ? undefined
                : isVideo
                ? 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)'
                : file.icon_type === 'image' || file.mime_type?.startsWith('image/')
                ? 'linear-gradient(135deg, #064e3b 0%, #0f172a 100%)'
                : file.icon_type === 'audio' || file.mime_type?.startsWith('audio/')
                ? 'linear-gradient(135deg, #451a03 0%, #0f172a 100%)'
                : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            }}
          >
            {imgError ? (
              <div className="td-thumb-corrupted" title={t('drive.thumbnail_corrupted')}>
                <ImageOff size={38} className="td-type-ico lg corrupted" />
                <span>{t('drive.thumbnail_corrupted_short')}</span>
              </div>
            ) : file.icon_type === 'link' ? (
              <div className="td-link-preview" aria-label={subLabel}>
                <div className="td-link-preview-domain">{linkHosts[0] || t('drive.view_links')}</div>
                <div className="td-link-preview-list">
                  {linkUrls.slice(0, 3).map((url, index) => (
                    <div className="td-link-preview-row" key={`${file.id}-${index}`} title={url}>
                      <span>{linkHosts[index] || url}</span>
                      <small>{url}</small>
                    </div>
                  ))}
                  {linkUrls.length > 3 ? (
                    <div className="td-link-preview-more">
                      {t('drive.link_preview_more', { count: linkUrls.length - 3 })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : thumbLoading && canThumb ? (
              <div className="td-thumb-loading">
                <Loader2 size={22} className="spin" />
                <span>{isVideo ? t('drive.loading_video') : t('drive.loading_short')}</span>
              </div>
            ) : (
              <div className="td-thumb-placeholder">
                <FileTypeIcon file={file} size="lg" />
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
          aria-label={selected ? t('drive.deselect') : t('drive.select')}
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
            <span className="td-video-duration" title={t('drive.duration_title', { duration: durationLabel, defaultValue: `Durasi ${durationLabel}` })}>
              {durationLabel}
            </span>
          ) : null}
          <div className="td-file-card-name" title={displayName}>
            {displayName}
          </div>
          <div className="td-file-card-sub" title={file.icon_type === 'link' ? (file.original_name || file.name) : undefined}>
            {file.icon_type === 'link' ? (
              <span className="td-file-card-size">{subLabel}</span>
            ) : (
              <div className="td-file-card-sub-row">
                <span className="td-file-card-size">{subLabel}</span>
                {drFmt ? (
                  <span className="td-tag-badge drive-fmt">
                    {drFmt}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="td-file-card-actions">
          {onPreview && (
            <button
              type="button"
              className="td-file-act"
              title={t('drive.topbar_preview')}
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
              title={t('drive.download_tab')}
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
              title={t('drive.btn_delete')}
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
      {!thumb && isVideo && visible && (
        <VideoCanvasThumbnailCapturer
          fileId={file.id}
          folderId={folderId}
          streamUrl={(file as any).stream_url || (file as any).streamUrl}
        />
      )}
      {isImage && (!thumb || isPlaceholderImg || file.file_ext === 'heic' || file.file_ext === 'heif' || file.file_ext === 'hif' || file.file_ext === 'tiff' || file.file_ext === 'tif') && visible && (
        <ImageCanvasThumbnailCapturer
          fileId={file.id}
          folderId={folderId}
          fileName={file.name}
          fileExt={file.file_ext}
          streamUrl={(file as any).stream_url || (file as any).streamUrl}
          localPath={(file as any).local_path || (file as any).path}
        />
      )}
    </div>
  );
}

export const DriveFileCard = memo(DriveFileCardInner, (prev, next) => {
  // Skip re-render when only parent inline function handlers churn during scroll.
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
    prev.creds?.session === next.creds?.session
  );
});
