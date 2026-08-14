import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat, PlatformKind } from '../types';

/**
 * Social Media Ultra-HD Stream Resolver (Instagram, Facebook, Twitter/X)
 */
export const socialMediaResolver: LinkResolverProvider = {
  name: 'SocialMediaResolver',
  platform: 'instagram',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return (
      u.includes('instagram.com') ||
      u.includes('facebook.com') ||
      u.includes('fb.watch') ||
      u.includes('twitter.com') ||
      u.includes('x.com')
    );
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    const u = cleanUrl.toLowerCase();
    let platform: PlatformKind = 'instagram';
    let platformName = 'Instagram';

    if (u.includes('facebook.com') || u.includes('fb.watch')) {
      platform = 'facebook';
      platformName = 'Facebook';
    } else if (u.includes('twitter.com') || u.includes('x.com')) {
      platform = 'twitter';
      platformName = 'Twitter / X';
    }

    let title = `${platformName}_Media_${Date.now()}`;
    let thumbnailUrl: string | undefined;
    let directUrl = cleanUrl;
    let ext = 'mp4';
    const formats: StreamQualityFormat[] = [];

    // Try Cobalt Tools API for highest quality clean extraction
    try {
      const resp = await fetch('https://api.cobalt.tools/api/json', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: cleanUrl,
          vQuality: 'max',
        }),
        signal: signal || AbortSignal.timeout(6000),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data && data.url) {
          directUrl = data.url;
          if (data.filename) {
            title = data.filename;
            const parts = title.split('.');
            if (parts.length > 1) ext = parts.pop()?.toLowerCase() || ext;
          }

          formats.push({
            id: `${platform}_hd_max`,
            label: `${platformName} Full HD / 4K Stream`,
            qualityTier: '1080p',
            resolution: '1080p / 4K Max',
            ext,
            directUrl,
            isVideo: true,
            isCleanNoWatermark: true,
            badge: `${platformName.toUpperCase()} HD`,
          });
        }
      }
    } catch {
      /* ignore */
    }

    // Fallback format
    if (formats.length === 0) {
      formats.push({
        id: `${platform}_source`,
        label: `${platformName} Source Stream`,
        qualityTier: 'original',
        ext: 'mp4',
        directUrl: cleanUrl,
        isVideo: true,
        badge: `${platformName.toUpperCase()} STREAM`,
      });
    }

    return {
      url: cleanUrl,
      platform,
      platformName,
      title,
      thumbnailUrl,
      formats,
      selectedFormatId: formats[0].id,
      resolvedAt: Date.now(),
    };
  },
};
