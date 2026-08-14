import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';

/**
 * Google Drive Link Resolver
 * Converts Google Drive share links into direct streamable download URLs.
 */
export const gdriveResolver: LinkResolverProvider = {
  name: 'GoogleDriveResolver',
  platform: 'gdrive',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return u.includes('drive.google.com') || u.includes('docs.google.com');
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    let fileId: string | null = null;

    // Pattern 1: /file/d/<id>/...
    const matchFileD = cleanUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (matchFileD && matchFileD[1]) {
      fileId = matchFileD[1];
    }

    // Pattern 2: ?id=<id> or &id=<id>
    if (!fileId) {
      const matchIdParam = cleanUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (matchIdParam && matchIdParam[1]) {
        fileId = matchIdParam[1];
      }
    }

    if (!fileId) {
      return null;
    }

    const directDownloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
    let title = `GoogleDrive_${fileId.slice(0, 8)}`;
    let bytes: number | undefined;
    let ext = 'bin';

    try {
      const resp = await fetch(directDownloadUrl, {
        method: 'HEAD',
        signal: signal || AbortSignal.timeout(5000),
      });

      if (resp.ok) {
        const cdisp = resp.headers.get('content-disposition');
        if (cdisp) {
          const match = cdisp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
          if (match && match[1]) {
            title = decodeURIComponent(match[1].trim());
            const parts = title.split('.');
            if (parts.length > 1) {
              ext = parts.pop()?.toLowerCase() || 'bin';
            }
          }
        }
        const clen = resp.headers.get('content-length');
        if (clen) {
          const parsed = parseInt(clen, 10);
          if (!isNaN(parsed) && parsed > 0) bytes = parsed;
        }
      }
    } catch {
      /* ignore HEAD probe error */
    }

    const format: StreamQualityFormat = {
      id: 'gdrive_direct',
      label: 'Google Drive Direct Stream',
      qualityTier: 'original',
      ext,
      filesizeBytes: bytes,
      directUrl: directDownloadUrl,
      badge: 'GDRIVE DIRECT',
    };

    return {
      url: cleanUrl,
      platform: 'gdrive',
      platformName: 'Google Drive',
      title,
      thumbnailUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w640`,
      formats: [format],
      selectedFormatId: 'gdrive_direct',
      isDirectFile: true,
      resolvedAt: Date.now(),
    };
  },
};
