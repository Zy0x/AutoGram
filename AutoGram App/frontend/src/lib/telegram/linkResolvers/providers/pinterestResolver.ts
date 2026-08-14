import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';

/**
 * Pinterest Uncompressed Original Resolver
 * Extracts original full-resolution images (originals/i.pinimg.com) and HD video streams.
 */
export const pinterestResolver: LinkResolverProvider = {
  name: 'PinterestResolver',
  platform: 'pinterest',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return u.includes('pinterest.com') || u.includes('pin.it') || u.includes('pinimg.com');
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    let directUrl = cleanUrl;
    let title = 'Pinterest_Media';
    let ext = 'jpg';
    let thumbnailUrl: string | undefined;

    // If it's pinimg.com, transform 736x / 564x / 236x to originals
    if (cleanUrl.includes('pinimg.com')) {
      directUrl = cleanUrl.replace(/\/\d+x\//, '/originals/');
      thumbnailUrl = directUrl;
      title = `Pinterest_${cleanUrl.split('/').pop() || 'Artwork'}`;
      ext = directUrl.split('.').pop()?.toLowerCase() || 'jpg';
    } else {
      try {
        const resp = await fetch(cleanUrl, {
          signal: signal || AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const html = await resp.text();
          // Extract og:image or og:video
          const imgMatch = html.match(/property="og:image"\s+content="([^"]+)"/i) ||
                           html.match(/name="og:image"\s+content="([^"]+)"/i);
          if (imgMatch && imgMatch[1]) {
            thumbnailUrl = imgMatch[1];
            directUrl = imgMatch[1].replace(/\/\d+x\//, '/originals/');
          }

          const vidMatch = html.match(/property="og:video:secure_url"\s+content="([^"]+)"/i) ||
                           html.match(/property="og:video"\s+content="([^"]+)"/i);
          if (vidMatch && vidMatch[1]) {
            directUrl = vidMatch[1];
            ext = 'mp4';
          }

          const titleMatch = html.match(/property="og:title"\s+content="([^"]+)"/i);
          if (titleMatch && titleMatch[1]) {
            title = titleMatch[1].trim();
          }
        }
      } catch {
        /* ignore */
      }
    }

    const isVideo = ext === 'mp4';

    const format: StreamQualityFormat = {
      id: 'pinterest_original',
      label: isVideo ? 'Original HD Video' : 'Original Uncompressed Artwork (Max Res)',
      qualityTier: 'original',
      ext,
      directUrl,
      isVideo,
      isImage: !isVideo,
      badge: isVideo ? 'PINTEREST HD VIDEO' : 'PINTEREST LOSSLESS',
    };

    return {
      url: cleanUrl,
      platform: 'pinterest',
      platformName: 'Pinterest (Original Res)',
      title,
      thumbnailUrl,
      formats: [format],
      selectedFormatId: 'pinterest_original',
      isDirectFile: true,
      resolvedAt: Date.now(),
    };
  },
};
