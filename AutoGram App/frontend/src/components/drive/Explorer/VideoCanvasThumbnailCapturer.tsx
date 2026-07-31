import { useEffect, useRef } from 'react';
import { cacheCapturedThumb } from '../../../lib/media/thumbBatcher';

type Props = {
  fileId: number;
  folderId: number | null;
  streamUrl?: string | null;
  onCaptured?: (url: string) => void;
};

/**
 * Isolated Last-Resort Video Canvas Frame Capturer.
 * Triggers ONLY as an offline/preview fallback when a video media has no static Telegram thumbnail.
 * Never modifies or interferes with standard thumbnail loading pipelines.
 */
export function VideoCanvasThumbnailCapturer({
  fileId,
  folderId,
  streamUrl,
  onCaptured,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const attemptedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!streamUrl || attemptedRef.current) return;
    attemptedRef.current = true;

    const video = document.createElement('video');
    videoRef.current = video;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (videoRef.current === video) {
        videoRef.current = null;
      }
    };

    const handleSeeked = () => {
      try {
        const width = video.videoWidth || 320;
        const height = video.videoHeight || 180;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          if (dataUrl && dataUrl.startsWith('data:image/jpeg')) {
            cacheCapturedThumb(folderId, fileId, dataUrl);
            if (onCaptured) {
              onCaptured(dataUrl);
            }
          }
        }
      } catch {
        /* CORS or canvas capture restriction ignored */
      } finally {
        cleanup();
      }
    };

    const handleLoadedMetadata = () => {
      try {
        // Seek to crucial second (1.0s or 10% of duration)
        const dur = video.duration || 10;
        const targetTime = Math.min(1.0, dur > 2 ? 1.0 : dur / 2);
        video.currentTime = targetTime;
      } catch {
        cleanup();
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    video.addEventListener('seeked', handleSeeked, { once: true });
    video.addEventListener('error', cleanup, { once: true });

    // 5-second timeout safety net
    const timer = setTimeout(cleanup, 5000);

    video.src = streamUrl;

    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [fileId, folderId, streamUrl, onCaptured]);

  return null;
}
