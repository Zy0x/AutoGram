import type { DriveCredentials, ZipTargetOpts } from '../../../lib/telegram/driveApi';
import { driveZipReadEntry } from '../../../lib/telegram/driveApi';
import { loadPersistentThumb, savePersistentThumb } from '../../../lib/media/thumbPersistentCache';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', '3gp']);

/** Checks if a ZIP entry name is a media format that can produce a thumbnail */
export function isMediaThumbnailSupported(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return false;
  return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
}

export function isImageEntry(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}

export function isVideoEntry(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext ? VIDEO_EXTENSIONS.has(ext) : false;
}

export function getZipThumbnailCacheKey(
  session: string,
  chatId: string | number,
  messageId: number,
  entryName: string
): string {
  return `v2:zip_thumb:${session || 'default'}_${chatId}_${messageId}_${entryName}`;
}

/** Downscales an image data URL onto a compact canvas to produce an ultra-lightweight WebP/JPEG thumbnail */
export async function downscaleImageToThumbnail(dataUrl: string, maxDim = 280): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const thumbUrl = canvas.toDataURL('image/webp', 0.82);
        resolve(thumbUrl.length > 50 ? thumbUrl : dataUrl);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
}

/** In-flight promise tracker to deduplicate concurrent thumbnail requests */
const inFlightThumbnails = new Map<string, Promise<string | null>>();

/**
 * On-demand manual loader for ZIP media thumbnails:
 * 1. Checks persistent local cache (IndexedDB) -> returns in 0ms (0 bytes network)
 * 2. If not found, requests only the exact byte range of this single entry over Grammers MTProto
 * 3. Downscales into a lightweight thumbnail and stores in persistent cache for future instant loads
 */
export async function fetchZipEntryThumbnail(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  entryName: string,
  password?: string | null,
  opts?: ZipTargetOpts
): Promise<string | null> {
  const chatId = opts?.peerId || (folderId != null && folderId !== 0 ? String(folderId) : 'me');
  const cacheKey = getZipThumbnailCacheKey(creds?.session || '', chatId, messageId, entryName);

  // 1. Check local persistent IndexedDB cache
  const cachedThumb = await loadPersistentThumb(cacheKey);
  if (cachedThumb) {
    return cachedThumb;
  }

  // 2. Reuse in-flight request if already pending
  const pending = inFlightThumbnails.get(cacheKey);
  if (pending) {
    return pending;
  }

  const fetchPromise = (async () => {
    try {
      // 3. Strict sparse byte-range read: only fetches this specific entry from MTProto
      const res = await driveZipReadEntry(
        creds,
        messageId,
        folderId,
        entryName,
        password || undefined,
        false,
        opts
      );

      if (res && res.status === 'success' && res.data_url) {
        let finalThumbUrl = res.data_url;

        // If it's an image, downscale it to conserve RAM and disk space
        if (res.kind === 'image' || isImageEntry(entryName)) {
          finalThumbUrl = await downscaleImageToThumbnail(res.data_url, 280);
        }

        // 4. Save to persistent cache so subsequent openings consume 0 bytes
        void savePersistentThumb(cacheKey, finalThumbUrl);
        return finalThumbUrl;
      }
      return null;
    } catch (err) {
      console.warn(`[ZipThumbnailManager] Could not load thumbnail for "${entryName}":`, err);
      return null;
    } finally {
      inFlightThumbnails.delete(cacheKey);
    }
  })();

  inFlightThumbnails.set(cacheKey, fetchPromise);
  return fetchPromise;
}
