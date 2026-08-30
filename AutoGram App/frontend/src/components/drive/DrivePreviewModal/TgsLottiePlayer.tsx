import React, { useEffect, useRef, useState } from 'react';
import lottie, { type AnimationItem } from 'lottie-web';
import { Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface TgsLottiePlayerProps {
  src: string;
  poster?: string | null;
  className?: string;
  style?: React.CSSProperties;
  zoom?: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  pan?: { x: number; y: number };
  onLoad?: () => void;
  onError?: (err: Error) => void;
}

/**
 * Decompresses Gzip-compressed Telegram .tgs sticker bytes and parses Lottie JSON.
 */
async function extractLottieData(src: string): Promise<Record<string, unknown>> {
  let arrayBuffer: ArrayBuffer;

  if (src.startsWith('data:')) {
    const commaIdx = src.indexOf(',');
    const base64Data = commaIdx !== -1 ? src.slice(commaIdx + 1) : src;
    const binaryStr = atob(base64Data);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    arrayBuffer = bytes.buffer;
  } else {
    const res = await fetch(src);
    if (!res.ok) {
      throw new Error(`Gagal mengunduh berkas stiker: HTTP ${res.status}`);
    }
    arrayBuffer = await res.arrayBuffer();
  }

  const uint8 = new Uint8Array(arrayBuffer);

  // Check GZIP header magic bytes: 0x1f, 0x8b
  if (uint8.length >= 2 && uint8[0] === 0x1f && uint8[1] === 0x8b) {
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const stream = new Response(uint8).body?.pipeThrough(new DecompressionStream('gzip'));
        if (stream) {
          const text = await new Response(stream).text();
          return JSON.parse(text);
        }
      } catch (gzipErr) {
        console.warn('[TgsLottiePlayer] Native DecompressionStream failed, fallback to raw parse', gzipErr);
      }
    }
  }

  // Fallback: If already plain JSON
  const text = new TextDecoder('utf-8').decode(uint8);
  return JSON.parse(text);
}

export const TgsLottiePlayer: React.FC<TgsLottiePlayerProps> = ({
  src,
  poster,
  className = '',
  style = {},
  zoom = 1,
  rotation = 0,
  flipH = false,
  flipV = false,
  pan = { x: 0, y: 0 },
  onLoad,
  onError,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [showSlowLoader, setShowSlowLoader] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsReady(false);
    setShowSlowLoader(false);
    setError(null);

    // Only show loading spinner if decompression/fetch takes > 400ms (anti-flicker)
    const timer = window.setTimeout(() => {
      if (active && !isReady) {
        setShowSlowLoader(true);
      }
    }, 400);

    if (animRef.current) {
      animRef.current.destroy();
      animRef.current = null;
    }

    if (!src) {
      window.clearTimeout(timer);
      return;
    }

    extractLottieData(src)
      .then((animationData) => {
        if (!active || !containerRef.current) return;

        if (animRef.current) {
          animRef.current.destroy();
          animRef.current = null;
        }

        const anim = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData,
          rendererSettings: {
            preserveAspectRatio: 'xMidYMid meet',
            progressiveLoad: true,
            hideOnTransparent: false,
          },
        });

        const markReady = () => {
          if (active) {
            window.clearTimeout(timer);
            setIsReady(true);
            setShowSlowLoader(false);
            onLoad?.();
          }
        };

        anim.addEventListener('DOMLoaded', markReady);
        anim.addEventListener('drawnFrame', () => {
          if (active && !isReady) {
            markReady();
          }
        });

        anim.addEventListener('data_failed', () => {
          if (active) {
            window.clearTimeout(timer);
            const msg = t('drive.tgs_lottie_invalid_data');
            const err = new Error(msg);
            setError(msg);
            setIsReady(false);
            setShowSlowLoader(false);
            onError?.(err);
          }
        });

        animRef.current = anim;
      })
      .catch((err) => {
        if (active) {
          window.clearTimeout(timer);
          console.warn('[TgsLottiePlayer] Error loading .tgs animation:', err);
          const msg = t('drive.tgs_lottie_load_failed');
          setError(err?.message || msg);
          setIsReady(false);
          setShowSlowLoader(false);
          onError?.(err instanceof Error ? err : new Error(msg));
        }
      });

    return () => {
      active = false;
      window.clearTimeout(timer);
      if (animRef.current) {
        animRef.current.destroy();
        animRef.current = null;
      }
    };
  }, [src, onLoad, onError]);

  const transformStyle: React.CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
    transformOrigin: 'center center',
    transition: 'transform 0.15s ease-out',
    maxWidth: '100%',
    maxHeight: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...style,
  };

  return (
    <div
      className={`relative w-full h-full flex items-center justify-center select-none overflow-hidden ${className}`}
      style={{ minWidth: 200, minHeight: 200 }}
    >
      {/* Visual transform container for both poster and animation */}
      <div
        style={transformStyle}
        className="relative w-[280px] h-[280px] sm:w-[360px] sm:h-[360px] max-w-[85vw] max-h-[85vh] flex items-center justify-center pointer-events-none"
      >
        {/* Instant crisp poster underneath (fades smoothly once Lottie is rendered) */}
        {poster && (
          <img
            src={poster}
            alt=""
            className="absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-200 ease-out"
            style={{
              opacity: isReady ? 0 : 1,
            }}
          />
        )}

        {/* Lottie SVG animation layer (fades in smoothly when ready) */}
        <div
          ref={containerRef}
          className="absolute inset-0 w-full h-full flex items-center justify-center pointer-events-none transition-opacity duration-200 ease-out"
          style={{
            opacity: isReady ? 1 : 0,
          }}
        />
      </div>

      {/* Subtle delayed loading indicator only for genuinely slow network requests (> 400ms) */}
      {showSlowLoader && !isReady && !error && (
        <div className="absolute flex items-center gap-2 bg-slate-900/90 text-sky-400 text-xs px-3 py-1.5 rounded-full border border-sky-500/30 backdrop-blur-md shadow-lg pointer-events-none z-10 animate-fade-in">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('drive.label_loading')}</span>
        </div>
      )}

      {/* Error display */}
      {error && !isReady && (
        <div className="absolute bottom-4 flex items-center gap-2 bg-amber-950/90 text-amber-300 text-xs px-3 py-1.5 rounded-full border border-amber-600/40 backdrop-blur-md shadow-lg pointer-events-none z-10">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
