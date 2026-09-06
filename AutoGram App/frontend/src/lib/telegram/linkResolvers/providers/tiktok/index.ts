import type { LinkResolverProvider, ResolvedMediaInfo, ResolveOptions } from '../../types';
import { isTikTokProfileUrl, resolveTikTokProfile } from './profileResolver';
import { resolveTikTokVideo } from './videoResolver';

export * from './types';
export * from './audioInspector';
export * from './profileResolver';
export * from './videoResolver';

/**
 * High-performance, modular TikTok & Douyin Link Resolver.
 * Features:
 * - Ultra HD no-watermark video extraction (up to 4K / 1080p @ 120fps)
 * - Intelligent audio inspection & copyright muting detection
 * - Automatic lossless audio-video remuxing for silent video streams
 * - Full photo slideshow album pack and individual slide extraction
 * - High-resolution (1080x1080) creator profile avatar extraction
 */
export const tiktokResolver: LinkResolverProvider = {
  name: 'TikTokResolver',
  platform: 'tiktok',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return u.includes('tiktok.com') || u.includes('douyin.com');
  },

  async resolve(url: string, signal?: AbortSignal, options?: ResolveOptions): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();

    // 1. Profile URL routing
    if (isTikTokProfileUrl(cleanUrl)) {
      const profileResult = await resolveTikTokProfile(cleanUrl, signal);
      if (profileResult) return profileResult;
    }

    // 2. Video & Slideshow URL routing
    return resolveTikTokVideo(cleanUrl, signal, options);
  },
};
