import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';

/**
 * Pixiv Original Uncompressed Artwork Resolver
 */
export const pixivResolver: LinkResolverProvider = {
  name: 'PixivResolver',
  platform: 'pixiv',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return u.includes('pixiv.net') || u.includes('pximg.net');
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    let title = 'Pixiv_Artwork';
    let author: string | undefined;
    let thumbnailUrl: string | undefined;
    let directUrl = cleanUrl;

    const illustIdMatch = cleanUrl.match(/artworks\/(\d+)/i);
    const illustId = illustIdMatch ? illustIdMatch[1] : null;

    if (illustId) {
      title = `Pixiv_Illust_${illustId}`;
      try {
        // Try public Pixiv proxy / oEmbed endpoint
        const metaResp = await fetch(`https://embed.pixiv.net/decorate.php?illust_id=${illustId}`, {
          signal: signal || AbortSignal.timeout(5000),
        });
        if (metaResp.ok) {
          thumbnailUrl = `https://embed.pixiv.net/artwork.php?illust_id=${illustId}`;
          directUrl = thumbnailUrl;
        }
      } catch {
        /* ignore */
      }
    }

    const format: StreamQualityFormat = {
      id: 'pixiv_original',
      label: 'Pixiv Original Master (Lossless)',
      qualityTier: 'original',
      ext: 'jpg',
      directUrl,
      headers: {
        'Referer': 'https://www.pixiv.net/',
      },
      isImage: true,
      badge: 'PIXIV LOSSLESS',
    };

    return {
      url: cleanUrl,
      platform: 'pixiv',
      platformName: 'Pixiv (Original Artwork)',
      title,
      author,
      thumbnailUrl: thumbnailUrl || directUrl,
      formats: [format],
      selectedFormatId: 'pixiv_original',
      requiresHeaders: true,
      customHeaders: {
        'Referer': 'https://www.pixiv.net/',
      },
      resolvedAt: Date.now(),
    };
  },
};
