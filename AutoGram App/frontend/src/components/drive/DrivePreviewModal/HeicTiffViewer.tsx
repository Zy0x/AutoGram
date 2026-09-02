import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertTriangle } from 'lucide-react';

interface HeicTiffViewerProps {
  src: string;        // local file path or blob URL or data URL
  fileName: string;
  onLoad?: (w: number, h: number) => void;
  onError?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Detects whether the binary buffer is already a browser-native image format
 * (JPEG, PNG, WebP, GIF, BMP, AVIF, ICO, SVG).
 */
export function detectBrowserNativeMime(buffer: ArrayBuffer): string | null {
  const u8 = new Uint8Array(buffer);
  const len = u8.length;
  if (len < 4) return null;

  // JPEG: FF D8 FF
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (len >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    return 'image/png';
  }

  // WebP: RIFF .... WEBP
  if (
    len >= 12 &&
    u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
    u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50
  ) {
    return 'image/webp';
  }

  // GIF: GIF87a / GIF89a (47 49 46 38)
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) {
    return 'image/gif';
  }

  // BMP: BM (42 4D)
  if (u8[0] === 0x42 && u8[1] === 0x4d) {
    return 'image/bmp';
  }

  // AVIF: ....ftypavif / ftypavis
  if (len >= 12 && u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
    const brand = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
    if (brand === 'avif' || brand === 'avis') {
      return 'image/avif';
    }
  }

  // ICO: 00 00 01 00
  if (u8[0] === 0x00 && u8[1] === 0x00 && u8[2] === 0x01 && u8[3] === 0x00) {
    return 'image/x-icon';
  }

  // SVG: <svg or <?xml (scan first 256 bytes)
  const scanLen = Math.min(len, 256);
  let str = '';
  for (let i = 0; i < scanLen; i++) {
    str += String.fromCharCode(u8[i]);
  }
  if (str.includes('<svg') || str.includes('xmlns="http://www.w3.org/2000/svg"')) {
    return 'image/svg+xml';
  }

  return null;
}

/** Lazy-load heavy decoders only when needed */
async function decodeHeic(buffer: ArrayBuffer): Promise<string> {
  // 1. Fast-path: check if buffer is already browser-native (e.g. JPEG disguised as HEIC)
  const nativeMime = detectBrowserNativeMime(buffer);
  if (nativeMime) {
    return URL.createObjectURL(new Blob([buffer], { type: nativeMime }));
  }

  // 2. Invoke heic2any with fallback handling
  try {
    const heic2any = (await import('heic2any')).default;
    const blob = await heic2any({
      blob: new Blob([buffer], { type: 'image/heic' }),
      toType: 'image/jpeg',
      quality: 0.92,
    });
    const outBlob = Array.isArray(blob) ? blob[0] : blob;
    return URL.createObjectURL(outBlob);
  } catch (err: any) {
    const errMsg = (err?.message || String(err || '')).toLowerCase();
    // heic2any throws "Image is already browser readable: image/jpeg" (or similar) when fed a non-HEIC image
    if (errMsg.includes('already browser readable') || errMsg.includes('err_user') || errMsg.includes('image/')) {
      const matchedMime = err?.message?.match(/image\/[a-zA-Z0-9.+-]+/)?.[0] || 'image/jpeg';
      return URL.createObjectURL(new Blob([buffer], { type: matchedMime }));
    }
    throw err;
  }
}

async function decodeTiff(buffer: ArrayBuffer): Promise<string> {
  // 1. Fast-path: check if buffer is already browser-native
  const nativeMime = detectBrowserNativeMime(buffer);
  if (nativeMime) {
    return URL.createObjectURL(new Blob([buffer], { type: nativeMime }));
  }

  try {
    const utif = (await import('utif2'));
    const UTIF = utif.default || utif;
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
    return new Promise<string>((resolve) => canvas.toBlob((b) => resolve(URL.createObjectURL(b!)), 'image/jpeg', 0.92));
  } catch (err: any) {
    if (nativeMime) {
      return URL.createObjectURL(new Blob([buffer], { type: nativeMime }));
    }
    throw err;
  }
}

type DecodeState = 'idle' | 'loading' | 'done' | 'error';

/**
 * Viewer for HEIC/HEIF and TIF/TIFF files.
 * Fetches the source as ArrayBuffer, decodes in-memory via JS libraries,
 * then renders the resulting JPEG blob URL.
 */
export const HeicTiffViewer: React.FC<HeicTiffViewerProps> = ({
  src,
  fileName,
  onLoad,
  onError,
  style,
  className,
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<DecodeState>('idle');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const blobRef = useRef<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const isTiff = ext === 'tif' || ext === 'tiff';
  const isHeic = ext === 'heic' || ext === 'heif';

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    setState('loading');
    setErrMsg(null);

    (async () => {
      try {
        const resp = await fetch(src);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        if (cancelled) return;

        let url: string;
        const nativeMime = detectBrowserNativeMime(buf);
        if (nativeMime) {
          url = URL.createObjectURL(new Blob([buf], { type: nativeMime }));
        } else if (isHeic) {
          url = await decodeHeic(buf);
        } else if (isTiff) {
          url = await decodeTiff(buf);
        } else {
          url = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
        }

        if (cancelled) { URL.revokeObjectURL(url); return; }
        if (blobRef.current) URL.revokeObjectURL(blobRef.current);
        blobRef.current = url;
        setBlobUrl(url);
        setState('done');
      } catch (e: any) {
        if (cancelled) return;
        setErrMsg(e?.message || String(e));
        setState('error');
        onError?.();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, isHeic, isTiff]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    };
  }, []);

  if (state === 'loading' || state === 'idle') {
    return (
      <div className="td-heictiff-loading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: '100%', color: '#94a3b8' }}>
        <Loader2 size={32} className="spin" />
        <span style={{ fontSize: 13 }}>
          {isHeic ? t('drive.decoding_heic') : t('drive.decoding_tiff')}
        </span>
      </div>
    );
  }

  if (state === 'error' || !blobUrl) {
    return (
      <div className="td-heictiff-error" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: '100%', color: '#f87171' }}>
        <AlertTriangle size={32} />
        <span style={{ fontSize: 13, textAlign: 'center', maxWidth: 300 }}>
          {t('drive.decode_error')}: {errMsg}
        </span>
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      src={blobUrl}
      alt={fileName}
      className={className}
      style={{ width: '100%', height: '100%', objectFit: 'contain', ...style }}
      onLoad={() => {
        const img = imgRef.current;
        if (img) onLoad?.(img.naturalWidth, img.naturalHeight);
      }}
      onError={() => { setState('error'); onError?.(); }}
      draggable={false}
    />
  );
};

export default HeicTiffViewer;
