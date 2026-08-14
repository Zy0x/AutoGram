import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';

/**
 * Mediafire Link Resolver
 * Extracts direct download button links from Mediafire share pages.
 */
export const mediafireResolver: LinkResolverProvider = {
  name: 'MediafireResolver',
  platform: 'mediafire',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return u.includes('mediafire.com');
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    let directUrl = cleanUrl;
    let title = 'Mediafire_File';
    let ext = 'bin';
    let bytes: number | undefined;

    try {
      const resp = await fetch(cleanUrl, {
        signal: signal || AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const html = await resp.text();
        // Match direct download link href: href="https://download...mediafire.com/..."
        const match = html.match(/aria-label="Download file"[^>]+href="([^"]+)"/i) ||
                      html.match(/id="downloadButton"[^>]+href="([^"]+)"/i) ||
                      html.match(/href="((?:https?:)?\/\/(?:download\d*|www)\.mediafire\.com\/[a-zA-Z0-9_-]+\/[^"]+)"/i);
        if (match && match[1]) {
          directUrl = match[1];
        }

        // Match filename
        const nameMatch = html.match(/class="filename">([^<]+)<\/div>/i) ||
                          html.match(/<div class="dl-btn-label"[^>]*title="([^"]+)"/i);
        if (nameMatch && nameMatch[1]) {
          title = nameMatch[1].trim();
          const parts = title.split('.');
          if (parts.length > 1) ext = parts.pop()?.toLowerCase() || ext;
        }
      }
    } catch {
      /* ignore */
    }

    const format: StreamQualityFormat = {
      id: 'mediafire_direct',
      label: 'Mediafire Direct Download',
      qualityTier: 'original',
      ext,
      filesizeBytes: bytes,
      directUrl,
      badge: 'MEDIAFIRE DIRECT',
    };

    return {
      url: cleanUrl,
      platform: 'mediafire',
      platformName: 'Mediafire',
      title,
      formats: [format],
      selectedFormatId: 'mediafire_direct',
      isDirectFile: true,
      resolvedAt: Date.now(),
    };
  },
};
