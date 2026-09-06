/**
 * Universal Upload Thumbnail Generator
 * Pre-generates high-quality 320px JPEG thumbnails for uploads (HEIC, TIFF, images)
 * and registers them via Tauri command `save_upload_thumbnail`.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { detectBrowserNativeMime } from '../../components/drive/DrivePreviewModal/HeicTiffViewer';

const THUMBNAIL_MAX_DIMENSION = 320;
const THUMBNAIL_JPEG_QUALITY = 0.85;

/**
 * Rescales an image/canvas to fit within maxDim x maxDim preserving aspect ratio,
 * and encodes to JPEG base64 data.
 */
function canvasToJpegBase64(
  source: HTMLImageElement | HTMLCanvasElement,
  origW: number,
  origH: number,
  maxDim = THUMBNAIL_MAX_DIMENSION,
  quality = THUMBNAIL_JPEG_QUALITY
): string {
  let targetW = origW;
  let targetH = origH;

  if (origW > maxDim || origH > maxDim) {
    if (origW >= origH) {
      targetW = maxDim;
      targetH = Math.max(1, Math.round((origH * maxDim) / origW));
    } else {
      targetH = maxDim;
      targetW = Math.max(1, Math.round((origW * maxDim) / origH));
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas 2d context');

  // Fill black background in case of alpha transparency
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(source, 0, 0, targetW, targetH);

  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Loads a Blob into an HTMLImageElement and rescales to 320px JPEG base64
 */
function loadNativeBlobToJpegBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const b64 = canvasToJpegBase64(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
        URL.revokeObjectURL(url);
        resolve(b64);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for thumbnail generation'));
    };
    img.src = url;
  });
}

/**
 * Decodes HEIC/HEIF buffer into an HTMLImageElement or directly draws to canvas
 */
async function decodeHeicToJpegBase64(buffer: ArrayBuffer): Promise<string> {
  const nativeMime = detectBrowserNativeMime(buffer);
  if (nativeMime) {
    return loadNativeBlobToJpegBase64(new Blob([buffer], { type: nativeMime }));
  }

  const heic2any = (await import('heic2any')).default;
  const blob = await heic2any({
    blob: new Blob([buffer], { type: 'image/heic' }),
    toType: 'image/jpeg',
    quality: 0.9,
  });
  const outBlob = Array.isArray(blob) ? blob[0] : blob;
  return loadNativeBlobToJpegBase64(outBlob);
}

/**
 * Decodes TIFF buffer into JPEG base64
 */
async function decodeTiffToJpegBase64(buffer: ArrayBuffer): Promise<string> {
  const utif = await import('utif2');
  const UTIF = (utif as any).default || utif;
  const ifds = UTIF.decode(buffer);
  if (!ifds || ifds.length === 0) throw new Error('No IFD found in TIFF');
  UTIF.decodeImage(buffer, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const w = ifds[0].width as number;
  const h = ifds[0].height as number;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(w, h);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);

  return canvasToJpegBase64(canvas, w, h);
}

/**
 * Generates and saves a 320x320 JPEG thumbnail for a local file path.
 * Returns the path of the saved thumbnail on disk, or null if skipped/failed.
 */
export async function pregenerateThumbnailForFile(filePath: string): Promise<string | null> {
  if (!filePath || filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return null;
  }

  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  // Candidates for frontend thumbnail generation:
  // HEIC, HEIF, TIFF, TIF (formats FFmpeg might struggle with or lack libheif)
  const isHeic = ext === 'heic' || ext === 'heif';
  const isTiff = ext === 'tif' || ext === 'tiff';
  const isNativeImage = ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext);

  if (!isHeic && !isTiff && !isNativeImage) {
    // Other pillars (video, audio, PDF, ZIP, code) are handled natively in Rust by FFmpeg / Universal Pillar Badges!
    return null;
  }

  try {
    const assetUrl = convertFileSrc(filePath);
    const res = await fetch(assetUrl);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();

    let jpegBase64: string;
    if (isHeic) {
      jpegBase64 = await decodeHeicToJpegBase64(buffer);
    } else if (isTiff) {
      jpegBase64 = await decodeTiffToJpegBase64(buffer);
    } else {
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'webp'
          ? 'image/webp'
          : ext === 'bmp'
          ? 'image/bmp'
          : 'image/jpeg';
      jpegBase64 = await loadNativeBlobToJpegBase64(new Blob([buffer], { type: mime }));
    }

    if (!jpegBase64) return null;

    // Send to Rust backend to save into upload thumbs directory
    const savedPath = await invoke<string>('save_upload_thumbnail', {
      sourcePath: filePath,
      jpegBase64,
    });

    return savedPath;
  } catch (err) {
    console.warn(`[uploadThumbnailGenerator] Failed to generate thumbnail for ${filePath}:`, err);
    // Non-fatal: Rust backend's Tier 2 / Tier 3 fallback will take over seamlessly!
    return null;
  }
}

/**
 * Batch pre-generates thumbnails for a list of file paths in parallel (capped concurrency).
 */
export async function pregenerateUploadThumbnails(filePaths: string[], maxConcurrent = 3): Promise<void> {
  const queue = [...filePaths];
  const workers = Array.from({ length: Math.min(queue.length, maxConcurrent) }, async () => {
    while (queue.length > 0) {
      const path = queue.shift();
      if (path) {
        await pregenerateThumbnailForFile(path);
      }
    }
  });
  await Promise.allSettled(workers);
}
