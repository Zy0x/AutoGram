import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat, ResolveOptions } from './types';
import { videeResolver } from './providers/videeResolver';
import { streamrizzResolver } from './providers/streamrizzResolver';
import { vqsoResolver } from './providers/vqsoResolver';
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
// In-memory resolve result cache — eliminates repeated yt-dlp subprocess
// spawns when the user re-inspects the same URL within the TTL window.
// TTL 30 minutes: well within YouTube's signed URL validity window (~6 h).
// ---------------------------------------------------------------------------
const RESOLVE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
interface CacheEntry { result: ResolvedMediaInfo; expiresAt: number }
const resolveResultCache = new Map<string, CacheEntry>();

function getCachedResult(url: string): ResolvedMediaInfo | null {
  const entry = resolveResultCache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    resolveResultCache.delete(url);
    return null;
  }
  return entry.result;
}

function setCachedResult(url: string, result: ResolvedMediaInfo): void {
  // Only cache non-empty results that came from a real provider.
  if (!result.formats || result.formats.length === 0) return;
  resolveResultCache.set(url, { result, expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Platforms that always provide durationSec from their own API response.
// These do NOT need the HTMLVideoElement fallback duration probe, which can
// consume seconds per format when there are 50+ quality cards (yt-dlp path).
// ---------------------------------------------------------------------------
const PLATFORMS_WITH_BUILT_IN_DURATION = new Set(['youtube', 'tiktok', 'twitter', 'pinterest', 'pixiv']);

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

async function probeVideoDuration(url: string, timeoutMs = 8000, signal?: AbortSignal): Promise<number | undefined> {
  if (typeof document === 'undefined' || signal?.aborted) return undefined;

  // Strategy 1: fetch first 512 KB via Range request → blob URL → video element
  // This bypasses CORS because fetch in Tauri WebView2 uses native HTTP (no CORS policy).
  // A 512 KB prefix is enough for MP4 files with faststart (moov at beginning).
  try {
    const ctrl = new AbortController();
    const onParentAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onParentAbort, { once: true });
    const fetchTimer = setTimeout(() => ctrl.abort(), timeoutMs - 1000);
    let blobUrl: string | undefined;
    try {
      const resp = await fetch(url, {
        headers: { Range: 'bytes=0-524287' }, // first 512 KB
        signal: ctrl.signal,
      });
      if ((resp.ok || resp.status === 206) && !signal?.aborted) {
        const buf = await resp.arrayBuffer();
        if (!signal?.aborted) {
          const blob = new Blob([buf], { type: 'video/mp4' });
          blobUrl = URL.createObjectURL(blob);
        }
      }
    } finally {
      clearTimeout(fetchTimer);
      if (signal) signal.removeEventListener('abort', onParentAbort);
    }

    if (blobUrl && !signal?.aborted) {
      const dur = await new Promise<number | undefined>((res) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;opacity:0;';
        document.body.appendChild(video);

        let done = false;
        const tid = setTimeout(() => finish(undefined), 6000);
        const onAbort = () => finish(undefined);
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        const finish = (d?: number) => {
          if (done) return; done = true;
          clearTimeout(tid);
          if (signal) signal.removeEventListener('abort', onAbort);
          video.pause();
          video.src = '';
          try { video.load(); } catch (_) {}
          try { document.body.removeChild(video); } catch (_) {}
          URL.revokeObjectURL(blobUrl!);
          res(d);
        };
        video.addEventListener('loadedmetadata', () => {
          const d = video.duration;
          finish(isFinite(d) && d > 0 ? Math.round(d) : undefined);
        }, { once: true });
        video.addEventListener('error', () => finish(undefined), { once: true });
        video.src = blobUrl;
        video.load();
      });
      if (dur) return dur;
    }
  } catch {
    // fetch failed (CORS, network, abort) — fall through to direct video probe
  }

  if (signal?.aborted) return undefined;

  // Strategy 2: direct URL fallback (works if server allows cross-origin video)
  return new Promise<number | undefined>((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.crossOrigin = 'anonymous';
    video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;opacity:0;';
    document.body.appendChild(video);

    let done = false;
    const tid = setTimeout(() => finish(undefined), timeoutMs);
    const onAbort = () => finish(undefined);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const finish = (dur?: number) => {
      if (done) return; done = true;
      clearTimeout(tid);
      if (signal) signal.removeEventListener('abort', onAbort);
      video.src = '';
      try { video.load(); } catch (_) {}
      try { document.body.removeChild(video); } catch (_) {}
      resolve(dur);
    };
    video.addEventListener('loadedmetadata', () => {
      const d = video.duration;
      finish(isFinite(d) && d > 0 ? Math.round(d) : undefined);
    }, { once: true });
    video.addEventListener('error', () => finish(undefined), { once: true });
    video.src = url;
    video.load();
  });
}

/**
 * After resolution, concurrently probe duration for all video formats
 * and mediaItems that have no durationSec yet. Mutates the result in-place.
 *
 * Performance: platforms like YouTube/TikTok always return durationSec from
 * their own API, so HTMLVideoElement probing is skipped entirely for them.
 * This avoids the cost of probing 50+ yt-dlp format URLs (each up to 10 s).
 */
async function enrichWithDurations(result: ResolvedMediaInfo, signal?: AbortSignal): Promise<ResolvedMediaInfo> {
  if (signal?.aborted) return result;
  const tasks: Promise<void>[] = [];

  // Skip video probing for platforms that already supply durationSec from
  // their own API (YouTube via yt-dlp, TikTok, Twitter, etc.).
  // For these, durationSec on the top-level result is the authoritative value.
  const hasBuiltInDuration = PLATFORMS_WITH_BUILT_IN_DURATION.has(result.platform || '');

  // Top-level formats — only probe for platforms without built-in duration
  // AND only when the top-level result itself has no durationSec yet.
  if (!result.durationSec && !hasBuiltInDuration) {
    for (const fmt of result.formats) {
      if (isVideoFormat(fmt) && !fmt.durationSec && fmt.directUrl) {
        tasks.push(
          probeVideoDuration(fmt.directUrl, 8000, signal).then((dur) => {
            if (dur && !signal?.aborted) {
              fmt.durationSec = dur;
              if (!result.durationSec) result.durationSec = dur;
            }
          })
        );
      }
    }
  }

  // mediaItems (gallery batch) — probe only unknown-duration items
  // but still skip per-format probing if the platform has built-in duration.
  if (result.mediaItems && result.mediaItems.length > 0) {
    for (const item of result.mediaItems) {
      if (item.kind !== 'video') continue;
      if (item.durationSec && item.durationSec > 0) continue;
      if (hasBuiltInDuration) continue; // platform already supplies duration

      // Find first video format with a URL
      const fmt = item.formats.find((f) => isVideoFormat(f) && f.directUrl && !f.durationSec);
      if (!fmt?.directUrl) continue;

      const fmtRef = fmt; // capture for closure
      const itemRef = item;
      tasks.push(
        probeVideoDuration(fmtRef.directUrl, 8000, signal).then((dur) => {
          if (dur && !signal?.aborted) {
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
    vqsoResolver,
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

    // 0. Cache hit — return immediately without any network or subprocess cost.
    //    A user-triggered re-inspection deliberately bypasses a previous result:
    //    expiring provider URLs and a repaired extractor must not be hidden by
    //    a still-valid fallback card.
    if (!signal?.aborted && !options?.discoveryCursor && !options?.forceRefresh) {
      const cached = getCachedResult(cleanUrl);
      if (cached) {
        return { ...cached, resolvedAt: Date.now() };
      }
    }

    // 1. Find matching specialized provider
    for (const provider of this.providers) {
      if (provider !== directFileResolver && provider !== nativeDeepResolver && provider.canHandle(cleanUrl)) {
        try {
          const result = await provider.resolve(cleanUrl, signal, options);
          if (result && result.formats && result.formats.length > 0) {
            const traced = this.withTrace(result, cleanUrl, provider.name, 'provider');
            const enriched = await enrichWithDurations(traced, signal);
            if (!options?.discoveryCursor) setCachedResult(cleanUrl, enriched);
            return enriched;
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
        if (nativeResult) {
          const traced = this.withTrace(nativeResult, cleanUrl, nativeDeepResolver.name, 'validated');
          return enrichWithDurations(traced, signal);
        }
      } catch {
        /* ignore */
      }
    }

    // 3. Fallback to universal direct file inspector
    try {
      const fallbackResult = await directFileResolver.resolve(cleanUrl, signal);
      if (fallbackResult && fallbackResult.formats.length > 0) {
        const traced = this.withTrace(fallbackResult, cleanUrl, directFileResolver.name, 'fallback');
        return enrichWithDurations(traced, signal);
      }
    } catch {
      /* ignore */
    }

    // 4. Do not manufacture a direct stream from a URL suffix. This is the
    // final honest state for a page that exposed no verifiable public media.
    const u = cleanUrl.split('?')[0];
    const rawName = u.split('/').filter(Boolean).pop() || 'remote_file';
    const ultimate = this.withTrace({
      url: cleanUrl,
      platform: 'direct',
      platformName: 'Remote Link',
      title: decodeURIComponent(rawName),
      formats: [],
      selectedFormatId: '',
      isDirectFile: false,
      discovery: {
        complete: true,
        pendingCount: 0,
        inspectedPages: 0,
        blockerReason: 'no_verified_public_media',
      },
      resolvedAt: Date.now(),
    }, cleanUrl, 'RawUrlFallback', 'fallback');
    return enrichWithDurations(ultimate, signal);
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
