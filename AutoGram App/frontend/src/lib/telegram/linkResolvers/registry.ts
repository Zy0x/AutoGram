import type { LinkResolverProvider, ResolvedMediaInfo, ResolveOptions } from './types';
import { pikpakResolver } from './providers/pikpakResolver';
import { youtubeResolver } from './providers/youtubeResolver';
import { tiktokResolver } from './providers/tiktokResolver';
import { gdriveResolver } from './providers/gdriveResolver';
import { dropboxResolver } from './providers/dropboxResolver';
import { mediafireResolver } from './providers/mediafireResolver';
import { teraboxResolver } from './providers/teraboxResolver';
import { pinterestResolver } from './providers/pinterestResolver';
import { pixivResolver } from './providers/pixivResolver';
import { socialMediaResolver } from './providers/socialMediaResolver';
import { knownRemoteHostResolver } from './providers/knownRemoteHostResolver';
import { nativeDeepResolver } from './providers/nativeDeepResolver';
import { directFileResolver } from './providers/directFileResolver';
import { assertSafeRemoteUrl } from './urlSafety';

/**
 * LinkResolverRegistry
 * Maintains priority list of platform resolvers and executes them in safe isolated boundaries.
 */
class LinkResolverRegistry {
  private providers: LinkResolverProvider[] = [
    pikpakResolver,
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
    nativeDeepResolver,
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
  public async resolve(url: string, signal?: AbortSignal, options?: ResolveOptions): Promise<ResolvedMediaInfo> {
    const cleanUrl = url.trim();
    assertSafeRemoteUrl(cleanUrl);

    // 1. Find matching specialized provider
    for (const provider of this.providers) {
      if (provider !== directFileResolver && provider !== nativeDeepResolver && provider.canHandle(cleanUrl)) {
        try {
          const result = await provider.resolve(cleanUrl, signal, options);
          if (result && result.formats && result.formats.length > 0) {
            return this.withTrace(result, cleanUrl, provider.name, 'provider');
          }
        } catch (err) {
          console.warn(`[LinkResolverRegistry] Provider ${provider.name} failed:`, err);
          // Don't throw, continue to next or fallback
        }
      }
    }

    // 2. Try desktop native deep crawler if in Tauri runtime
    if (nativeDeepResolver.canHandle(cleanUrl)) {
      try {
        const nativeResult = await nativeDeepResolver.resolve(cleanUrl, signal, options);
        if (nativeResult && nativeResult.formats && nativeResult.formats.length > 0) {
          return this.withTrace(nativeResult, cleanUrl, nativeDeepResolver.name, 'validated');
        }
      } catch {
        /* ignore */
      }
    }

    // 2. Fallback to universal direct file inspector
    try {
      const fallbackResult = await directFileResolver.resolve(cleanUrl, signal);
      if (fallbackResult) return this.withTrace(fallbackResult, cleanUrl, directFileResolver.name, 'fallback');
    } catch {
      /* ignore */
    }

    // 3. Ultimate safe fallback
    const u = cleanUrl.split('?')[0];
    const rawName = u.split('/').filter(Boolean).pop() || 'remote_file';
    return this.withTrace({
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
    }, cleanUrl, 'RawUrlFallback', 'fallback');
  }

  private withTrace(
    result: ResolvedMediaInfo,
    sourceUrl: string,
    resolverName: string,
    securityStatus: 'validated' | 'provider' | 'fallback'
  ): ResolvedMediaInfo {
    if (result.resolutionTrace) return result;
    return {
      ...result,
      resolutionTrace: {
        resolverName,
        sourceUrl,
        finalUrl: result.formats[0]?.directUrl || result.url,
        candidateCount: result.formats.length,
        securityStatus,
        stages: ['analyze', 'resolve', 'discover', 'validate', 'ready'],
      },
    };
  }
}

export const linkResolverRegistry = new LinkResolverRegistry();
