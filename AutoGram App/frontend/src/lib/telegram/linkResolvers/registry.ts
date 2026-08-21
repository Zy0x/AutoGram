import type { LinkResolverProvider, ResolvedMediaInfo } from './types';
import { youtubeResolver } from './providers/youtubeResolver';
import { tiktokResolver } from './providers/tiktokResolver';
import { gdriveResolver } from './providers/gdriveResolver';
import { dropboxResolver } from './providers/dropboxResolver';
import { mediafireResolver } from './providers/mediafireResolver';
import { teraboxResolver } from './providers/teraboxResolver';
import { pinterestResolver } from './providers/pinterestResolver';
import { pixivResolver } from './providers/pixivResolver';
import { socialMediaResolver } from './providers/socialMediaResolver';
import { directFileResolver } from './providers/directFileResolver';
import { knownRemoteHostResolver } from './providers/knownRemoteHostResolver';
import { nativeDeepResolver } from './providers/nativeDeepResolver';

/**
 * LinkResolverRegistry
 * Maintains priority list of platform resolvers and executes them in safe isolated boundaries.
 */
class LinkResolverRegistry {
  private providers: LinkResolverProvider[] = [
    nativeDeepResolver,
    tiktokResolver,
    youtubeResolver,
    gdriveResolver,
    dropboxResolver,
    mediafireResolver,
    teraboxResolver,
    pinterestResolver,
    pixivResolver,
    socialMediaResolver,
    knownRemoteHostResolver,
    directFileResolver, // Fallback provider
  ];

  /**
   * Register a new provider dynamically (for future extensions)
   */
  public registerProvider(provider: LinkResolverProvider, priority: 'high' | 'low' = 'high') {
    if (priority === 'high') {
      this.providers.unshift(provider);
    } else {
      this.providers.push(provider);
    }
  }

  /**
   * Resolve any remote URL with fail-safe error isolation.
   */
  public async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo> {
    const cleanUrl = url.trim();

    // 1. Find matching specialized provider
    for (const provider of this.providers) {
      if (provider !== directFileResolver && provider.canHandle(cleanUrl)) {
        try {
          const result = await provider.resolve(cleanUrl, signal);
          if (result && result.formats && result.formats.length > 0) {
            return result;
          }
        } catch (err) {
          console.warn(`[LinkResolverRegistry] Provider ${provider.name} failed:`, err);
          // Don't throw, continue to next or fallback
        }
      }
    }

    // 2. Fallback to universal direct file inspector
    try {
      const fallbackResult = await directFileResolver.resolve(cleanUrl, signal);
      if (fallbackResult) return fallbackResult;
    } catch {
      /* ignore */
    }

    // 3. Ultimate safe fallback
    const u = cleanUrl.split('?')[0];
    const rawName = u.split('/').filter(Boolean).pop() || 'remote_file';
    return {
      url: cleanUrl,
      platform: 'direct',
      platformName: 'Direct Download Link',
      title: decodeURIComponent(rawName),
      formats: [
        {
          id: 'direct_raw',
          label: 'Direct Stream (Source)',
          qualityTier: 'original',
          ext: rawName.includes('.') ? rawName.split('.').pop()?.toLowerCase() || 'bin' : 'bin',
          directUrl: cleanUrl,
          badge: 'DIRECT STREAM',
        },
      ],
      selectedFormatId: 'direct_raw',
      isDirectFile: true,
      resolvedAt: Date.now(),
    };
  }
}

export const linkResolverRegistry = new LinkResolverRegistry();
