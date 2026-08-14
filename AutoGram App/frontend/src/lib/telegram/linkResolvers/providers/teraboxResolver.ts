import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';

/**
 * Terabox Direct Stream Resolver
 * Bypasses Terabox share pages and extracts direct CDN download stream.
 */
export const teraboxResolver: LinkResolverProvider = {
  name: 'TeraboxResolver',
  platform: 'terabox',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return (
      u.includes('terabox.com') ||
      u.includes('teraboxapp.com') ||
      u.includes('1024tera.com') ||
      u.includes('mirrobox.com') ||
      u.includes('4funbox.com') ||
      u.includes('terasharelink.com')
    );
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    let title = 'Terabox_Download';
    let bytes: number | undefined;
    let ext = 'bin';
    let directUrl = cleanUrl;
    let thumbnailUrl: string | undefined;

    try {
      // Try public Terabox direct scraper API
      const apiEndpoint = `https://terabox-api.online/api?url=${encodeURIComponent(cleanUrl)}`;
      const resp = await fetch(apiEndpoint, {
        signal: signal || AbortSignal.timeout(6000),
      });

      if (resp.ok) {
        const json = await resp.json();
        if (json && (json.download_link || json.dlink || json.url)) {
          directUrl = json.download_link || json.dlink || json.url;
          if (json.file_name) {
            title = json.file_name;
            const parts = title.split('.');
            if (parts.length > 1) ext = parts.pop()?.toLowerCase() || ext;
          }
          if (json.size) {
            bytes = typeof json.size === 'number' ? json.size : parseInt(json.size, 10);
          }
          if (json.thumb || json.thumbnail) {
            thumbnailUrl = json.thumb || json.thumbnail;
          }
        }
      }
    } catch {
      /* fallback */
    }

    const format: StreamQualityFormat = {
      id: 'terabox_direct',
      label: 'Terabox High-Speed Direct Stream',
      qualityTier: 'original',
      ext,
      filesizeBytes: bytes,
      directUrl,
      badge: 'TERABOX DIRECT',
    };

    return {
      url: cleanUrl,
      platform: 'terabox',
      platformName: 'Terabox Direct Stream',
      title,
      thumbnailUrl,
      formats: [format],
      selectedFormatId: 'terabox_direct',
      isDirectFile: true,
      resolvedAt: Date.now(),
    };
  },
};
