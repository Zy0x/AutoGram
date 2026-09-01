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

/** Lazy-load heavy decoders only when needed */
async function decodeHeic(buffer: ArrayBuffer): Promise<string> {
  // Dynamic import to avoid bundling unless HEIC file is opened
  const heic2any = (await import('heic2any')).default;
  const blob = await heic2any({
    blob: new Blob([buffer], { type: 'image/heic' }),
    toType: 'image/jpeg',
    quality: 0.92,
  });
  const outBlob = Array.isArray(blob) ? blob[0] : blob;
  return URL.createObjectURL(outBlob);
}

async function decodeTiff(buffer: ArrayBuffer): Promise<string> {
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
        if (isHeic) {
          url = await decodeHeic(buf);
        } else if (isTiff) {
          url = await decodeTiff(buf);
        } else {
          throw new Error('Unsupported format for HeicTiffViewer');
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
