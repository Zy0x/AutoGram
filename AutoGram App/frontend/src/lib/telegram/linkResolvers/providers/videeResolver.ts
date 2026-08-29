import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../../tauri/platform';
import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';
import { assertSafeRemoteUrl } from '../urlSafety';

interface VideeVideoItem {
  id: string;
  title: string;
  thumbnailUrl?: string;
  directUrl: string;
  filesizeBytes?: number;
}

const VIDEE_HOSTS = /(^|\.)(videe\.(?:cc|co|me|net|is|to)|videy\.(?:co|cc|net|io)|videyo\.(?:co|cc))$/i;

export function isVideeHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return VIDEE_HOSTS.test(host);
  } catch {
    return false;
  }
}

async function fetchRemoteHtml(url: string, signal?: AbortSignal, referer?: string): Promise<string> {
  if (detectTauriRuntime()) {
    try {
      const text = await invoke<string>('fetch_remote_text_content', {
        url,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        headers: referer ? { Referer: referer } : undefined,
      });
      if (text && text.trim()) return text;
    } catch {
      /* fallback to native fetch */
    }
  }

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  if (referer) headers.Referer = referer;

  const resp = await fetch(url, {
    headers,
    signal: signal || AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    throw new Error(`HTTP error ${resp.status}`);
  }
  return await resp.text();
}

/**
 * Probes the content length of direct stream URLs.
 */
async function probeDirectStreamLength(url: string, referer?: string): Promise<number | undefined> {
  if (!url || !url.startsWith('http')) return undefined;

  if (detectTauriRuntime()) {
    try {
      const meta = await invoke<{ status: number; contentLength?: number }>('fetch_remote_head_meta', {
        url,
        headers: referer ? { Referer: referer } : undefined,
      });
      if (meta && meta.contentLength && meta.contentLength > 0) {
        return meta.contentLength;
      }
    } catch {
      /* fallback */
    }
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Range: 'bytes=0-1',
    };
    if (referer) headers.Referer = referer;

    const resp = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000),
    });

    const rangeHeader = resp.headers.get('content-range');
    if (rangeHeader) {
      const parts = rangeHeader.split('/');
      if (parts.length > 1) {
        const total = parseInt(parts[1], 10);
        if (!isNaN(total) && total > 0) return total;
      }
    }

    const clen = resp.headers.get('content-length');
    if (clen && resp.status === 200) {
      const total = parseInt(clen, 10);
      if (!isNaN(total) && total > 0) return total;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Resolves a single Videe.cc video from its embed player page.
 */
async function resolveVideeSingleVideo(
  videoId: string,
  hintTitle?: string,
  hintThumb?: string,
  signal?: AbortSignal,
  skipProbeLength = false
): Promise<VideeVideoItem | null> {
  const embedUrl = `https://videe.cc/v/${videoId}`;
  const referer = `https://videe.cc/e/${videoId}`;

  try {
    const html = await fetchRemoteHtml(embedUrl, signal, referer);

    // Extract title from <title> or fallback
    let title = hintTitle;
    if (!title) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        const raw = titleMatch[1].trim();
        if (raw && !raw.toLowerCase().includes('not found')) {
          title = raw;
        }
      }
    }
    if (!title) {
      title = `Videe_${videoId}.mp4`;
    }

    // Extract direct video stream (Plyr player call or <source>)
    const directMatch =
      html.match(/loadPlyr\(['"]([^'"]+)['"]\)/i) ||
      html.match(/<source\s+src=['"]([^'"]+)['"]/i) ||
      html.match(/src:\s*['"](https:\/\/[^'"]+\.mp4[^'"]*)['"]/i);

    if (!directMatch || !directMatch[1]) {
      return null;
    }

    const directUrl = directMatch[1];

    // Extract thumbnail
    let thumb = hintThumb;
    if (!thumb) {
      const thumbMatch =
        html.match(/poster=['"]([^'"]+)['"]/i) ||
        html.match(/data-src=['"]([^'"]+)['"]/i);
      if (thumbMatch && thumbMatch[1]) {
        thumb = thumbMatch[1].startsWith('http')
          ? thumbMatch[1]
          : `https://videe.cc${thumbMatch[1]}`;
      }
    }

    const filesizeBytes = skipProbeLength ? undefined : await probeDirectStreamLength(directUrl, referer);

    return {
      id: videoId,
      title,
      thumbnailUrl: thumb,
      directUrl,
      filesizeBytes,
    };
  } catch (err) {
    console.warn(`[VideeResolver] Failed to resolve video ${videoId}:`, err);
    return null;
  }
}

/**
 * Dedicated Videe.cc & Videy.co Link Resolver Provider
 * Automatically handles:
 * 1. Single video pages / embeds (/v/:id, /e/:id, :id.mp4)
 * 2. Multi-video Folders and Collections (/folderId.mp4 or /folderId)
 * 3. Videy.co direct CDN video endpoints
 */
export const videeResolver: LinkResolverProvider = {
  name: 'VideeResolver',
  platform: 'direct',

  canHandle(url: string): boolean {
    return isVideeHost(url);
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    assertSafeRemoteUrl(cleanUrl);

    const parsedUrl = new URL(cleanUrl);
    const host = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname;

    // 1. Handle Videy.co
    if (host.includes('videy.co')) {
      const rawId = parsedUrl.searchParams.get('id') || pathname.split('/').filter(Boolean).pop()?.replace(/\.(mp4|mov)$/i, '') || '';
      if (!rawId) return null;

      const ext =
        !rawId || rawId.length === 8 || (rawId.length === 9 && rawId.endsWith('1'))
          ? 'mp4'
          : rawId.length === 9 && rawId.endsWith('2')
            ? 'mov'
            : 'mp4';
      const directUrl = `https://cdn.videy.co/${rawId}.${ext}`;
      const title = `videy_${rawId}.${ext}`;
      const filesizeBytes = await probeDirectStreamLength(directUrl);

      const format: StreamQualityFormat = {
        id: `videy_${rawId}`,
        label: title,
        customTitle: title,
        customFilename: title,
        qualityTier: 'original',
        ext,
        filesizeBytes,
        directUrl,
        isVideo: true,
        badge: 'VIDEY DIRECT',
        thumbnailUrl: `https://cdn.videy.co/${rawId}.mp4#t=0.001`,
      };

      return {
        url: cleanUrl,
        platform: 'direct',
        platformName: 'Videy Video',
        title,
        thumbnailUrl: format.thumbnailUrl,
        formats: [format],
        selectedFormatId: format.id,
        isDirectFile: true,
        resolvedAt: Date.now(),
      };
    }

    // 2. Handle Videe.cc
    const html = await fetchRemoteHtml(cleanUrl, signal);

    // Check if the page is a folder / collection of videos
    const isFolder =
      html.includes('class="video-wrapper') ||
      html.includes('/e/') ||
      html.includes('const folderId =');

    if (isFolder) {
      // Extract album/folder items
      const itemRegex =
        /<a\s+href="\/e\/([a-zA-Z0-9_-]+)"[^>]*>[\s\S]*?(?:data-src="([^"]+)")?[\s\S]*?<strong>([^<]+)<\/strong>/gi;
      const rawEntries: Array<{ id: string; thumb?: string; title: string }> = [];
      let match;
      while ((match = itemRegex.exec(html)) !== null) {
        const id = match[1];
        const thumb = match[2]
          ? match[2].startsWith('http')
            ? match[2]
            : `https://videe.cc${match[2]}`
          : undefined;
        const title = match[3]?.trim() || `video_${id}`;
        rawEntries.push({ id, thumb, title });
      }

      if (rawEntries.length === 0) {
        // Fallback search for /e/ links
        const linkMatches = [...html.matchAll(/\/e\/([a-zA-Z0-9_-]+)/gi)];
        const seen = new Set<string>();
        for (const lm of linkMatches) {
          if (!seen.has(lm[1])) {
            seen.add(lm[1]);
            rawEntries.push({ id: lm[1], title: `Videe_${lm[1]}` });
          }
        }
      }

      if (rawEntries.length === 0) {
        throw new Error('No videos found in Videe folder');
      }

      // Title from page or URL query parameter
      const queryTitle = parsedUrl.searchParams.get('v') || parsedUrl.searchParams.get('title');
      let folderTitle = queryTitle ? decodeURIComponent(queryTitle).trim() : '';
      if (!folderTitle) {
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          folderTitle = titleMatch[1].replace(/Watch on Videy.*?$/i, '').trim();
        }
      }
      if (!folderTitle) {
        folderTitle = `Videe Folder (${rawEntries.length} Videos)`;
      }

      // Eagerly resolve the initial batch of videos (first 6 items) for instant live preview playback
      const eagerCount = Math.min(rawEntries.length, 6);
      const validResolved: VideeVideoItem[] = [];
      const resolvedChunk = await Promise.all(
        rawEntries
          .slice(0, eagerCount)
          .map((item) => resolveVideeSingleVideo(item.id, item.title, item.thumb, signal, true))
      );
      for (const item of resolvedChunk) {
        if (item) validResolved.push(item);
      }

      if (validResolved.length === 0 && rawEntries.length > 0) {
        const first = await resolveVideeSingleVideo(rawEntries[0].id, rawEntries[0].title, rawEntries[0].thumb, signal, false);
        if (first) validResolved.push(first);
      }

      if (validResolved.length === 0) {
        throw new Error('Failed to resolve direct streams for Videe folder');
      }

      const formats: StreamQualityFormat[] = [];
      const mediaItems = [];

      // 1. All Folder Videos Pack Option
      const validUrls = validResolved.map((v) => v.directUrl);
      if (rawEntries.length > 1) {
        const totalSize = validResolved.reduce((acc, v) => acc + (v.filesizeBytes || 0), 0);
        formats.push({
          id: 'videe_all_folder_pack',
          label: `All Folder Videos (${rawEntries.length} Videos - Batch Pack)`,
          qualityTier: 'original',
          ext: 'mp4',
          filesizeBytes: totalSize > 0 ? totalSize : undefined,
          directUrl: validUrls[0],
          isAlbumPack: true,
          allAlbumUrls: validUrls,
          isVideo: true,
          badge: `ALL ${rawEntries.length} VIDEOS`,
          thumbnailUrl: validResolved[0]?.thumbnailUrl,
        });
      }

      // 2. Individual video formats and media items for the full collection
      for (let i = 0; i < rawEntries.length; i++) {
        const entry = rawEntries[i];
        const resolvedMatch = validResolved.find((r) => r.id === entry.id);

        const rawTitle = entry.title || `Videe_${entry.id}.mp4`;
        const filename = rawTitle.toLowerCase().endsWith('.mp4') ? rawTitle : `${rawTitle}.mp4`;
        const directUrl = resolvedMatch?.directUrl || `https://videe.cc/v/${entry.id}`;
        const thumb = resolvedMatch?.thumbnailUrl || entry.thumb || `https://videe.cc/thumbnails/${entry.id}.jpeg`;

        const fmt: StreamQualityFormat = {
          id: `videe_video_${i}_${entry.id}`,
          label: filename,
          customTitle: rawTitle,
          customFilename: filename,
          qualityTier: 'original',
          ext: 'mp4',
          filesizeBytes: resolvedMatch?.filesizeBytes,
          directUrl,
          isVideo: true,
          badge: 'DIRECT HD',
          thumbnailUrl: thumb,
        };

        formats.push(fmt);

        mediaItems.push({
          id: `videe_item_${i}_${entry.id}`,
          title: rawTitle,
          thumbnailUrl: thumb,
          kind: 'video' as const,
          selectedFormatId: fmt.id,
          formats: [fmt],
        });
      }

      return {
        url: cleanUrl,
        platform: 'direct',
        platformName: 'Videe Collection',
        title: folderTitle,
        thumbnailUrl: validResolved[0]?.thumbnailUrl || rawEntries[0]?.thumb,
        description: `Videe folder containing ${rawEntries.length} videos.`,
        formats,
        mediaItems,
        selectedFormatId: formats[0]?.id || 'videe_all_folder_pack',
        totalItems: rawEntries.length,
        isDirectFile: true,
        resolvedAt: Date.now(),
      };
    }

    // 3. Single Video on Videe.cc
    const rawId = pathname.split('/').filter(Boolean).pop()?.replace(/\.(mp4|mov)$/i, '') || '';
    if (!rawId) return null;

    const singleVideo = await resolveVideeSingleVideo(rawId, undefined, undefined, signal);
    if (!singleVideo) {
      throw new Error(`Failed to resolve direct video for Videe ID: ${rawId}`);
    }

    const filename = singleVideo.title.toLowerCase().endsWith('.mp4')
      ? singleVideo.title
      : `${singleVideo.title}.mp4`;

    const format: StreamQualityFormat = {
      id: `videe_${singleVideo.id}`,
      label: filename,
      customTitle: singleVideo.title,
      customFilename: filename,
      qualityTier: 'original',
      ext: 'mp4',
      filesizeBytes: singleVideo.filesizeBytes,
      directUrl: singleVideo.directUrl,
      isVideo: true,
      badge: 'DIRECT HD',
      thumbnailUrl: singleVideo.thumbnailUrl,
    };

    return {
      url: cleanUrl,
      platform: 'direct',
      platformName: 'Videe Video',
      title: singleVideo.title,
      thumbnailUrl: singleVideo.thumbnailUrl,
      formats: [format],
      selectedFormatId: format.id,
      isDirectFile: true,
      resolvedAt: Date.now(),
    };
  },
};
