import { useState, useEffect, useCallback, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { DriveCredentials } from '../../../lib/telegram/driveApi';
import {
  canShowDriveThumb,
  type DriveFile,
} from '../../../lib/telegram/driveTypes';
import {
  getCachedThumb,
  getCachedSaverThumb,
  requestThumb,
} from '../../../lib/media/thumbBatcher';
import type { PreviewThumbItem } from './NewMediaFloatingPill';

export interface UsePillPreviewThumbsOptions {
  contentNotice: { kind: string; count: number; targetId: number | null } | null;
  displayed: DriveFile[];
  folderId: number | null;
  creds: DriveCredentials | null;
  thumbQuality?: string;
  locationType?: string;
  topicId?: number | null;
}

function safeConvertFileSrc(path?: string | null): string | null {
  if (!path || typeof path !== 'string') return null;
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

/**
 * Extracts immediate synchronous thumbnails (inline data URLs, local asset paths, or RAM cache).
 */
export function extractImmediatePreviewThumbs(
  targetFiles: DriveFile[],
  folderId: number | null,
  session?: string,
  thumbQuality?: string
): PreviewThumbItem[] {
  return targetFiles.slice(0, 3).map((file) => {
    const inline = file.thumb_data_url || file.thumbDataUrl;
    let url: string | null = null;
    if (inline && typeof inline === 'string' && inline.startsWith('data:image/')) {
      url = inline;
    } else {
      const local = (file as any).local_path || (file as any).localPath;
      const converted = safeConvertFileSrc(local);
      if (converted) {
        url = converted;
      } else {
        const thumbLocator = { peerId: file.peer_id, topicId: file.topic_id };
        if (canShowDriveThumb(file)) {
          const cached = getCachedThumb(folderId, file.id, thumbLocator);
          if (cached) url = cached;
        }
        if (!url) {
          const saver =
            thumbQuality === 'saver' || !canShowDriveThumb(file)
              ? getCachedSaverThumb(folderId, file.id, session, thumbLocator)
              : undefined;
          if (saver) url = saver;
        }
      }
    }
    return {
      id: file.id,
      url,
      name: file.name,
    };
  });
}

/**
 * High-performance thumbnail resolver for the floating "New Media" pill.
 * Proactively resolves 1-3 micro thumbnails using instant synchronous sources,
 * priority 'visible' background requests, and real-time Tauri/batcher event subscriptions.
 */
export function usePillPreviewThumbs({
  contentNotice,
  displayed,
  folderId,
  creds,
  thumbQuality,
  locationType,
  topicId,
}: UsePillPreviewThumbsOptions): PreviewThumbItem[] {
  const [resolvedUrls, setResolvedUrls] = useState<Record<number, string>>({});

  const targetFiles = useMemo(() => {
    if (!contentNotice || contentNotice.kind !== 'added') return [];
    const count = Math.min(3, contentNotice.count);
    return displayed.slice(0, count);
  }, [contentNotice, displayed]);

  const getBestThumbUrl = useCallback(
    (file: DriveFile): string | null => {
      // 1. Dynamic state hit from live events / async request
      if (resolvedUrls[file.id]) return resolvedUrls[file.id];

      // 2. Inline data url (instant from Telegram list_media or upload generator)
      const inline = file.thumb_data_url || file.thumbDataUrl;
      if (inline && typeof inline === 'string' && inline.startsWith('data:image/')) {
        return inline;
      }

      // 3. Local file path for photos/videos just uploaded or cached locally
      const local = (file as any).local_path || (file as any).localPath;
      const converted = safeConvertFileSrc(local);
      if (converted) return converted;

      // 4. Memory cache from thumbBatcher
      const thumbLocator = { peerId: file.peer_id, topicId: file.topic_id };
      if (canShowDriveThumb(file)) {
        const cached = getCachedThumb(folderId, file.id, thumbLocator);
        if (cached) return cached;
      }

      // 5. Saver cache from thumbBatcher / IndexedDB
      const saver =
        thumbQuality === 'saver' || !canShowDriveThumb(file)
          ? getCachedSaverThumb(folderId, file.id, creds?.session, thumbLocator)
          : undefined;
      if (saver) return saver;

      return null;
    },
    [resolvedUrls, folderId, creds?.session, thumbQuality]
  );

  useEffect(() => {
    if (!targetFiles.length || !creds) return;

    let cancelled = false;

    // Request thumbs proactively for any file missing a URL
    targetFiles.forEach((file) => {
      const immediateUrl = getBestThumbUrl(file);
      if (!immediateUrl && canShowDriveThumb(file)) {
        void requestThumb(creds, folderId, file.id, {
          priority: 'visible',
          peerId: file.peer_id ? String(file.peer_id) : undefined,
          topicId: file.topic_id ?? topicId ?? undefined,
          locationType: locationType ?? 'group',
        })
          .then((url) => {
            if (!cancelled && url) {
              setResolvedUrls((prev) => (prev[file.id] === url ? prev : { ...prev, [file.id]: url }));
            }
          })
          .catch(() => {});
      }
    });

    // Listen for live thumbnail ready events
    const onThumbReady = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.url || cancelled) return;
      for (const file of targetFiles) {
        if (
          detail.key &&
          (detail.key.includes(`:${file.id}:`) || detail.key.includes(`:${file.id}`))
        ) {
          setResolvedUrls((prev) =>
            prev[file.id] === detail.url ? prev : { ...prev, [file.id]: detail.url }
          );
        }
      }
    };

    // Listen for batch transfer done events
    const onTransferBatchDone = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.messageIds || !Array.isArray(detail.messageIds) || cancelled) return;
      for (const file of targetFiles) {
        if (detail.messageIds.includes(file.id)) {
          void requestThumb(creds, folderId, file.id, {
            priority: 'visible',
            peerId: file.peer_id ? String(file.peer_id) : undefined,
            topicId: file.topic_id ?? topicId ?? undefined,
            locationType: locationType ?? 'group',
          })
            .then((url) => {
              if (!cancelled && url) {
                setResolvedUrls((prev) =>
                  prev[file.id] === url ? prev : { ...prev, [file.id]: url }
                );
              }
            })
            .catch(() => {});
        }
      }
    };

    window.addEventListener('autogram-thumb-ready', onThumbReady);
    window.addEventListener('autogram-transfer-batch-done', onTransferBatchDone);

    return () => {
      cancelled = true;
      window.removeEventListener('autogram-thumb-ready', onThumbReady);
      window.removeEventListener('autogram-transfer-batch-done', onTransferBatchDone);
    };
  }, [targetFiles, creds, folderId, locationType, topicId, getBestThumbUrl]);

  return useMemo(() => {
    return targetFiles.map((file) => ({
      id: file.id,
      url: getBestThumbUrl(file),
      name: file.name,
    }));
  }, [targetFiles, getBestThumbUrl]);
}
