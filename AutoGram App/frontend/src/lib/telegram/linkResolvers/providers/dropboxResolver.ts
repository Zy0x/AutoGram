import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';

/**
 * Dropbox Link Resolver
 * Converts Dropbox share links into direct binary download URLs.
 */
export const dropboxResolver: LinkResolverProvider = {
  name: 'DropboxResolver',
  platform: 'dropbox',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return u.includes('dropbox.com');
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    let directUrl = cleanUrl;

    if (directUrl.includes('?dl=0')) {
      directUrl = directUrl.replace('?dl=0', '?dl=1');
    } else if (directUrl.includes('&dl=0')) {
      directUrl = directUrl.replace('&dl=0', '&dl=1');
    } else if (!directUrl.includes('dl=1')) {
      directUrl += directUrl.includes('?') ? '&dl=1' : '?dl=1';
    }

    let title = 'Dropbox_File';
    let ext = 'bin';
    let bytes: number | undefined;

    try {
      const u = new URL(cleanUrl);
      const segs = u.pathname.split('/').filter(Boolean);
      const filename = segs.pop();
      if (filename && filename !== 'fi') {
        title = decodeURIComponent(filename);
        const parts = title.split('.');
        if (parts.length > 1) {
          ext = parts.pop()?.toLowerCase() || ext;
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const resp = await fetch(directUrl, {
        method: 'HEAD',
        signal: signal || AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const clen = resp.headers.get('content-length');
        if (clen) {
          const parsed = parseInt(clen, 10);
          if (!isNaN(parsed) && parsed > 0) bytes = parsed;
        }
      }
    } catch {
      /* ignore */
    }

    const format: StreamQualityFormat = {
      id: 'dropbox_direct',
      label: 'Dropbox Direct Binary Stream',
      qualityTier: 'original',
      ext,
      filesizeBytes: bytes,
      directUrl,
      badge: 'DROPBOX DIRECT',
    };

    return {
      url: cleanUrl,
      platform: 'dropbox',
      platformName: 'Dropbox',
      title,
      formats: [format],
      selectedFormatId: 'dropbox_direct',
      isDirectFile: true,
      resolvedAt: Date.now(),
    };
  },
};
