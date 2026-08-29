import type { LinkResolverProvider, ResolvedMediaInfo, ResolvedMediaItem, StreamQualityFormat, ResolveOptions } from './types';
import { videeResolver } from './providers/videeResolver';
import { streamrizzResolver } from './providers/streamrizzResolver';
import { pikpakResolver } from './providers/pikpakResolver';
import { youtubeResolver } from './providers/youtubeResolver';
import { tiktokResolver } from './providers/tiktokResolver';
import { gdriveResolver } from './providers/gdriveResolver';
import { dropboxResolver } from './providers/dropboxResolver';
import { mediafireResolver } from './providers/mediafireResolver';
import { teraboxResolver } from './providers/teraboxResolver';
import { twitterResolver } from './providers/twitterResolver';
import { pinterestResolver } from './providers/pinterestResolver';
import { pixivResolver } from './providers/pixivResolver';
import { socialMediaResolver } from './providers/socialMediaResolver';
import { knownRemoteHostResolver } from './providers/knownRemoteHostResolver';
import { nativeDeepResolver } from './providers/nativeDeepResolver';
import { directFileResolver } from './providers/directFileResolver';
import { assertSafeRemoteUrl } from './urlSafety';

// ---------------------------------------------------------------------------
// Video duration probe via hidden <video preload="metadata">
// Works in both browser and WebView2 (Tauri). Resolves with undefined on error.
// ---------------------------------------------------------------------------
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'm4v', 'mpd', 'm3u8']);

function isVideoFormat(fmt: StreamQualityFormat): boolean {
  return !!(
    fmt.isVideo ||
    (fmt.ext && VIDEO_EXTS.has(fmt.ext.toLowerCase()))
  );
}

function probeVideoDuration(url: string, timeoutMs = 8000): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(undefined);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    let done = false;
    const finish = (dur?: number) => {
      if (done) return;
      done = true;
      clearTimeout(tid);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('error', onErr);
      // Release the resource immediately
      video.src = '';
      try { video.load(); } catch (_) {}
      resolve(dur);
    };

    const onMeta = () => {
      const d = video.duration;
      finish(isFinite(d) && d > 0 ? Math.round(d) : undefined);
    };
    const onErr = () => finish(undefined);

    const tid = setTimeout(() => finish(undefined), timeoutMs);

    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.addEventListener('error', onErr, { once: true });
    video.src = url;
    video.load();
  });
}

/**
 * After resolution, concurrently probe duration for all video formats
 * and mediaItems that have no durationSec yet. Mutates the result in-place.
 */
async function enrichWithDurations(result: ResolvedMediaInfo): Promise<ResolvedMediaInfo> {
  const tasks: Promise<void>[] = [];

  // Top-level formats
  if (!result.durationSec) {
    for (const fmt of result.formats) {
      if (isVideoFormat(fmt) && !fmt.durationSec && fmt.directUrl) {
        tasks.push(
          probeVideoDuration(fmt.directUrl).then((dur) => {
            if (dur) {
              fmt.durationSec = dur;
              if (!result.durationSec) result.durationSec = dur;
            }
          })
        );
      }
    }
  }

  // mediaItems (gallery batch)
  if (result.mediaItems && result.mediaItems.length > 0) {
    for (const item of result.mediaItems) {
      if (item.kind !== 'video') continue;
      if (item.durationSec && item.durationSec > 0) continue;

      // Find first video format with a URL
      const fmt = item.formats.find((f) => isVideoFormat(f) && f.directUrl && !f.durationSec);
      if (!fmt?.directUrl) continue;

      const fmtRef = fmt; // capture for closure
      const itemRef = item;
      tasks.push(
        probeVideoDuration(fmtRef.directUrl).then((dur) => {
          if (dur) {
            fmtRef.durationSec = dur;
            itemRef.durationSec = dur;
          }
        })
      );
    }
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }

  return result;
}

/**
 * LinkResolverRegistry
 * Maintains priority list of platform resolvers and executes them in safe isolated boundaries.
 */
class LinkResolverRegistry {
  private providers: LinkResolverProvider[] = [
    videeResolver,
    streamrizzResolver,
    pikpakResolver,
    tiktokResolver,
    youtubeResolver,
    twitterResolver,
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
            const traced = this.withTrace(result, cleanUrl, provider.name, 'provider');
            return enrichWithDurations(traced);
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
          const traced = this.withTrace(nativeResult, cleanUrl, nativeDeepResolver.name, 'validated');
          return enrichWithDurations(traced);
        }
      } catch {
        /* ignore */
      }
    }

    // 3. Fallback to universal direct file inspector
    try {
      const fallbackResult = await directFileResolver.resolve(cleanUrl, signal);
      if (fallbackResult) {
        const traced = this.withTrace(fallbackResult, cleanUrl, directFileResolver.name, 'fallback');
        return enrichWithDurations(traced);
      }
    } catch {
      /* ignore */
    }

    // 4. Ultimate safe fallback
    const u = cleanUrl.split('?')[0];
    const rawName = u.split('/').filter(Boolean).pop() || 'remote_file';
    const ultimate = this.withTrace({
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
    return enrichWithDurations(ultimate);
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
