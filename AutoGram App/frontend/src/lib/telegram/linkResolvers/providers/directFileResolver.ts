import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';
import { assertSafeRemoteUrl } from '../urlSafety';

/**
 * Universal Direct File Resolver
 * Inspects raw HTTP/HTTPS URLs with live HEAD / Range requests to determine
 * exact Content-Type, Content-Length, and filename from Content-Disposition.
 */
export const directFileResolver: LinkResolverProvider = {
  name: 'DirectFileResolver',
  platform: 'direct',

  canHandle(url: string): boolean {
    const u = url.trim().toLowerCase();
    return u.startsWith('http://') || u.startsWith('https://');
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    assertSafeRemoteUrl(cleanUrl);
    let title = 'remote_file';
    let ext = 'bin';
    let bytes: number | undefined;
    let mime = 'application/octet-stream';

    try {
      const u = new URL(cleanUrl);
      const pathSeg = u.pathname.split('/').filter(Boolean).pop();
      if (pathSeg) {
        title = decodeURIComponent(pathSeg);
        const parts = title.split('.');
        if (parts.length > 1) {
          ext = parts.pop()?.toLowerCase() || 'bin';
        }
      }
    } catch {
      /* ignore url parse error */
    }

    try {
      const resp = await fetch(cleanUrl, {
        method: 'HEAD',
        signal: signal || AbortSignal.timeout(5000),
      });

      if (resp.ok) {
        const ctype = resp.headers.get('content-type');
        if (ctype) mime = ctype.toLowerCase();

        const clen = resp.headers.get('content-length');
        if (clen) {
          const parsedLen = parseInt(clen, 10);
          if (!isNaN(parsedLen) && parsedLen > 0) {
            bytes = parsedLen;
          }
        }

        const cdisp = resp.headers.get('content-disposition');
        if (cdisp) {
          const match = cdisp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
          if (match && match[1]) {
            title = decodeURIComponent(match[1].trim());
            const parts = title.split('.');
            if (parts.length > 1) {
              ext = parts.pop()?.toLowerCase() || ext;
            }
          }
        }
      }
    } catch {
      /* network or timeout error on HEAD, use URL-based fallback */
    }

    const isVideo = mime.startsWith('video/') || ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv'].includes(ext);
    const isImage = mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
    const isAudio = mime.startsWith('audio/') || ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'aac'].includes(ext);
    const isHtmlPage = /(?:text\/html|application\/xhtml\+xml)/i.test(mime);

    const defaultFormat: StreamQualityFormat = {
      id: 'direct_stream',
      label: isHtmlPage ? 'remote_web_page_handoff' : 'Direct Stream (Source)',
      qualityTier: 'original',
      ext,
      filesizeBytes: bytes,
      directUrl: cleanUrl,
      isVideo,
      isImage,
      isAudio,
      badge: isHtmlPage ? 'remote_web_page' : isVideo ? 'DIRECT VIDEO' : isImage ? 'DIRECT IMAGE' : isAudio ? 'DIRECT AUDIO' : 'DIRECT FILE',
    };

    return {
      url: cleanUrl,
      platform: 'direct',
      platformName: 'Direct Download Link',
      title,
      formats: [defaultFormat],
      selectedFormatId: 'direct_stream',
      isDirectFile: !isHtmlPage,
      resolvedAt: Date.now(),
    };
  },
};
