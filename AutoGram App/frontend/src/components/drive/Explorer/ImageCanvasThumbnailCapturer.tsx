import { useEffect, useRef } from 'react';
import { cacheCapturedThumb } from '../../../lib/media/thumbBatcher';
import { detectBrowserNativeMime } from '../DrivePreviewModal/HeicTiffViewer';

type Props = {
  fileId: number;
  folderId: number | null;
  fileName: string;
  fileExt?: string | null;
  streamUrl?: string | null;
  localPath?: string | null;
  onCaptured?: (url: string) => void;
};

function scaleCanvasToDataUrl(
  source: HTMLImageElement | HTMLCanvasElement,
  origW: number,
  origH: number,
  maxDim = 320
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
  if (!ctx) return '';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(source, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function blobToScaledDataUrl(blob: Blob, maxDim = 320): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const dataUrl = scaleCanvasToDataUrl(
          img,
          img.naturalWidth || img.width,
          img.naturalHeight || img.height,
          maxDim
        );
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch {
        URL.revokeObjectURL(url);
        resolve('');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('');
    };
    img.src = url;
  });
}

/**
 * Isolated Image Canvas Frame Capturer for HEIC, TIFF, and visual media.
 * Automatically decodes and caches high-quality 320px JPEG thumbnails
 * when only a fallback pillar badge or missing thumbnail is available.
 */
export function ImageCanvasThumbnailCapturer({
  fileId,
  folderId,
  fileName,
  fileExt,
  streamUrl,
  localPath,
  onCaptured,
}: Props) {
  const attemptedRef = useRef<boolean>(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        let buf: ArrayBuffer | null = null;
        if (localPath) {
          try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const u8 = await readFile(localPath);
            buf = u8.buffer;
          } catch {
            // ignore
          }
        }

        if (!buf && streamUrl) {
          try {
            const resp = await fetch(streamUrl);
            if (resp.ok) {
              buf = await resp.arrayBuffer();
            }
          } catch {
            // ignore
          }
        }

        if (!buf && fileName) {
          try {
            const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
            // Check Downloads
            try {
              const u8 = await readFile(fileName, { baseDir: BaseDirectory.Download });
              buf = u8.buffer;
            } catch {
              // Check Desktop
              try {
                const u8 = await readFile(fileName, { baseDir: BaseDirectory.Desktop });
                buf = u8.buffer;
              } catch {
                // ignore
              }
            }
          } catch {
            // ignore
          }
        }

        if (!buf || buf.byteLength === 0 || cancelled) return;

        const ext = (fileExt || fileName.split('.').pop() || '').toLowerCase();
        const isHeic = ext === 'heic' || ext === 'heif' || ext === 'hif';
        const isTiff = ext === 'tif' || ext === 'tiff';

        let dataUrl: string | null = null;

        if (isHeic) {
          const heic2anyMod = (await import('heic2any')) as any;
          const heic2any =
            (typeof (window as any).heic2any === 'function' ? (window as any).heic2any : null) ||
            (typeof heic2anyMod === 'function' ? heic2anyMod : null) ||
            (typeof heic2anyMod?.default === 'function' ? heic2anyMod.default : null);

          if (heic2any) {
            const blob = await heic2any({
              blob: new Blob([buf], { type: 'image/heic' }),
              toType: 'image/jpeg',
              quality: 0.85,
            });
            const outBlob = Array.isArray(blob) ? blob[0] : blob;
            dataUrl = await blobToScaledDataUrl(outBlob, 320);
          }
        } else if (isTiff) {
          const utif = await import('utif2');
          const UTIF = (utif as any).default || utif;
          const ifds = UTIF.decode(buf);
          if (ifds && ifds.length > 0) {
            UTIF.decodeImage(buf, ifds[0]);
            const rgba = UTIF.toRGBA8(ifds[0]);
            const w = ifds[0].width as number;
            const h = ifds[0].height as number;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const imgData = ctx.createImageData(w, h);
              imgData.data.set(rgba);
              ctx.putImageData(imgData, 0, 0);
              dataUrl = scaleCanvasToDataUrl(canvas, w, h, 320);
            }
          }
        } else {
          const detected = detectBrowserNativeMime(buf);
          const mime =
            detected ||
            (ext === 'png'
              ? 'image/png'
              : ext === 'webp'
              ? 'image/webp'
              : ext === 'gif'
              ? 'image/gif'
              : ext === 'bmp'
              ? 'image/bmp'
              : ext === 'svg' || ext === 'svgz'
              ? 'image/svg+xml'
              : ext === 'avif' || ext === 'avis'
              ? 'image/avif'
              : ext === 'ico'
              ? 'image/x-icon'
              : 'image/jpeg');
          const blob = new Blob([buf], { type: mime });
          dataUrl = await blobToScaledDataUrl(blob, 320);
        }

        if (dataUrl && !cancelled && dataUrl.startsWith('data:image/jpeg')) {
          cacheCapturedThumb(folderId, fileId, dataUrl);
          onCaptured?.(dataUrl);
        }
      } catch {
        // Silent fallback: never throw in capturer
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId, folderId, fileName, fileExt, streamUrl, localPath, onCaptured]);

  return null;
}
