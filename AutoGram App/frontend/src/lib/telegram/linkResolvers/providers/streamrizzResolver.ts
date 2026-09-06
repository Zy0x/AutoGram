import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../../tauri/platform';
import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';
import { assertSafeRemoteUrl } from '../urlSafety';

interface StreamRizzVideoItem {
  id: string;
  title: string;
  thumbnailUrl?: string;
  directUrl: string;
  filesizeBytes?: number;
}

interface StreamRizzFolderPage {
  title: string;
  folders: Array<{ url: string; title?: string }>;
  videos: Array<{ id: string; thumb?: string; title?: string }>;
}

const STREAMRIZZ_HOSTS = /(^|\.)(streamrizz\.(?:com|net|org)|vidoy\.(?:com|net|asia|org)|vidoycdn\.(?:com|net)|overfetch\.video)$/i;

function isStreamrizzHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return STREAMRIZZ_HOSTS.test(host);
  } catch {
    return false;
  }
}

async function fetchRemoteHtml(url: string, signal?: AbortSignal): Promise<string> {
  if (detectTauriRuntime()) {
    try {
      const text = await invoke<string>('fetch_remote_text_content', {
        url,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      if (text && text.trim()) return text;
    } catch {
      /* fallback to native fetch */
    }
  }

  const resp = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: signal || AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    throw new Error(`HTTP error ${resp.status}`);
  }
  return await resp.text();
}

async function probeContentLength(url: string): Promise<number | undefined> {
  if (!url || !url.startsWith('http')) return undefined;
  if (detectTauriRuntime()) {
    try {
      const meta = await invoke<{ status: number; contentLength?: number }>('fetch_remote_head_meta', {
        url,
        headers: {
          Referer: 'https://streamrizz.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });
      if (meta && meta.contentLength && meta.contentLength > 0) {
        return meta.contentLength;
      }
    } catch {
      /* fallback */
    }
  }

  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      headers: { Referer: 'https://streamrizz.com/' },
      signal: AbortSignal.timeout(4000),
    });
    const len = resp.headers.get('content-length');
    if (len) {
      const n = parseInt(len, 10);
      if (!isNaN(n) && n > 0) return n;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function parseEmbedPayload(token: string): any | null {
  try {
    const payloadBase64 = token.split('.')[0];
    const normalized = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = atob(normalized);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

async function resolveVideoDetail(
  id: string,
  fallbackTitle?: string,
  fallbackThumb?: string,
  signal?: AbortSignal
): Promise<StreamRizzVideoItem | null> {
  try {
    const videoPageUrl = `https://streamrizz.com/d/${id}`;
    const html = await fetchRemoteHtml(videoPageUrl, signal);

    const tokenMatch = html.match(/embedToken\s*=\s*['"]([^'"]+)['"]/);
    if (!tokenMatch) {
      const rawTitle = fallbackTitle || `Video_${id}.mp4`;
      return {
        id,
        title: rawTitle,
        thumbnailUrl: fallbackThumb,
        directUrl: videoPageUrl,
      };
    }

    const payload = parseEmbedPayload(tokenMatch[1]);
    const cleanTitle = (payload?.ti || fallbackTitle || `Video_${id}.mp4`).trim();
    const thumb = payload?.im ? `https://i.streamrizz.com/image/${payload.im}` : fallbackThumb;
    const rf = payload?.rf;
    const directUrl = rf ? `https://mp4-01.overfetch.video/${rf}` : `https://streamrizz.com/d/${id}`;

    let filesizeBytes: number | undefined;
    if (directUrl.includes('overfetch.video')) {
      filesizeBytes = await probeContentLength(directUrl);
    }

    return {
      id,
      title: cleanTitle,
      thumbnailUrl: thumb,
      directUrl,
      filesizeBytes,
    };
  } catch {
    return null;
  }
}

function inferVideoResolutionBadge(title?: string): string {
  if (!title) return 'HD';
  const t = title.toLowerCase();
  if (t.includes('8k') || t.includes('4320p')) return '8K ULTRA HD';
  if (t.includes('4k') || t.includes('2160p') || t.includes('uhd')) return '4K UHD';
  if (t.includes('2k') || t.includes('1440p') || t.includes('qhd')) return '2K QHD';
  if (t.includes('1080p') || t.includes('1080') || t.includes('fhd')) return '1080p FULL HD';
  if (t.includes('720p') || t.includes('720')) return '720p HD';
  if (t.includes('480p') || t.includes('480') || t.includes('sd')) return '480p SD';
  return 'HD';
}

function parseFolderPage(html: string, pageUrl: string): StreamRizzFolderPage {
  const titleMatch =
    html.match(/<h1[^>]*class="[^"]*drive-title[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
    html.match(/<title>([^<]+)<\/title>/i);
  const title = (titleMatch?.[1] || 'StreamRizz Folder')
    .replace(/^[📂\s]+/, '')
    .replace(/ - StreamRizz$/i, '')
    .trim();
  const folders: Array<{ url: string; title?: string }> = [];
  const folderSeen = new Set<string>();
  const folderRegex = /<a[^>]*href="(\/(?:f|folder)\/[a-zA-Z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(folderRegex)) {
    try {
      const absolute = new URL(match[1], pageUrl).toString();
      if (folderSeen.has(absolute)) continue;
      folderSeen.add(absolute);
      const cleanLabel = String(match[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      folders.push({ url: absolute, title: cleanLabel || undefined });
    } catch {
      // Ignore malformed/untrusted hrefs; the native resolver applies the
      // same URL safety policy before it visits a page.
    }
  }

  const videos: Array<{ id: string; thumb?: string; title?: string }> = [];
  const videoSeen = new Set<string>();
  const addVideo = (id: string, thumb?: string, videoTitle?: string) => {
    if (videoSeen.has(id)) return;
    videoSeen.add(id);
    videos.push({ id, thumb, title: videoTitle?.trim() || undefined });
  };
  const articleBlocks = html.match(/<article[^>]*class="[^"]*drive-file-card[^"]*"[^>]*>[\s\S]*?<\/article>/gi) || [];
  for (const block of articleBlocks) {
    const idMatch = block.match(/href="\/(?:d|v|e)\/([a-zA-Z0-9_-]+)"/i);
    if (!idMatch) continue;
    const thumbMatch = block.match(/<img[^>]*src="([^"]+)"/i);
    const titleMatch = block.match(/title="([^"]+)"/i) || block.match(/class="[^"]*file-name[^"]*"[^>]*>([^<]+)</i);
    addVideo(idMatch[1], thumbMatch?.[1], titleMatch?.[1]);
  }
  // Some folder pages render cards without the article wrapper. Keep this
  // fallback deliberately scoped to /d|/v|/e links so navigation is ignored.
  const linkRegex = /<a[^>]*href="\/(?:d|v|e)\/([a-zA-Z0-9_-]+)"[^>]*(?:title="([^"]*)"|aria-label="([^"]*)")?[^>]*>/gi;
  for (const match of html.matchAll(linkRegex)) {
    addVideo(match[1], undefined, match[2] || match[3]);
  }
  return { title, folders, videos };
}

/**
 * StreamRizz & Vidoy Link Resolver
 * Detects single videos and multi-video folders/directories on streamrizz.com, vidoy.com, etc.
 * Extracts high-speed direct CDN streams from mp4-01.overfetch.video with accurate media sizes and batch pack support.
 */
export const streamrizzResolver: LinkResolverProvider = {
  name: 'StreamRizzResolver',
  platform: 'direct',

  canHandle(url: string): boolean {
    return isStreamrizzHost(url);
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    assertSafeRemoteUrl(cleanUrl);

    // The native crawler validates each public payload and carries a cursor
    // across nested folders. Keep this browser resolver as a web fallback;
    // desktop must not bypass validation with a title/extension-only card.
    if (detectTauriRuntime()) return null;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(cleanUrl);
    } catch {
      return null;
    }

    const pathname = parsedUrl.pathname;
    const isFolder = pathname.startsWith('/f/') || pathname.startsWith('/folder/');
    const isDirectVideo =
      pathname.startsWith('/d/') ||
      pathname.startsWith('/v/') ||
      pathname.startsWith('/e/') ||
      parsedUrl.hostname.includes('overfetch.video');

    if (isFolder) {
      // 1. Folder Resolution: walk nested folders breadth-first. A bounded
      // page budget keeps a huge public tree responsive while still allowing
      // the user to resolve every discovered media item in one inspection.
      const folderQueue = [cleanUrl];
      const visitedFolders = new Set<string>();
      const videoEntries: Array<{ id: string; thumb?: string; title?: string; parentUrl?: string }> = [];
      const seenVideos = new Set<string>();
      let folderTitle = 'StreamRizz Folder';
      let inspectedFolders = 0;
      const MAX_FOLDER_PAGES = 256;
      while (folderQueue.length > 0 && inspectedFolders < MAX_FOLDER_PAGES) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const folderUrl = folderQueue.shift()!;
        if (visitedFolders.has(folderUrl)) continue;
        visitedFolders.add(folderUrl);
        let page: StreamRizzFolderPage;
        try {
          page = parseFolderPage(await fetchRemoteHtml(folderUrl, signal), folderUrl);
        } catch {
          continue;
        }
        inspectedFolders += 1;
        if (folderUrl === cleanUrl) folderTitle = page.title;
        for (const nested of page.folders) {
          if (!visitedFolders.has(nested.url)) folderQueue.push(nested.url);
        }
        for (const entry of page.videos) {
          const key = entry.id;
          if (seenVideos.has(key)) continue;
          seenVideos.add(key);
          videoEntries.push({ ...entry, parentUrl: folderUrl });
        }
      }

      if (videoEntries.length === 0) {
        throw new Error('No videos detected in StreamRizz folder');
      }

      // Resolve video details in parallel batches of 5
      const resolvedVideos: StreamRizzVideoItem[] = [];
      const batchSize = 5;
      for (let i = 0; i < videoEntries.length; i += batchSize) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunk = videoEntries.slice(i, i + batchSize);
        const results = await Promise.all(
          chunk.map((item) => resolveVideoDetail(item.id, item.title, item.thumb, signal))
        );
        for (const res of results) {
          if (res) resolvedVideos.push(res);
        }
      }

      if (resolvedVideos.length === 0) {
        throw new Error('Failed to resolve videos from StreamRizz folder');
      }

      const validDirectUrls: string[] = resolvedVideos
        .map((v) => v.directUrl)
        .filter((u) => u.startsWith('http'));

      const formats: StreamQualityFormat[] = [];

      // Master batch pack option at index 0
      if (resolvedVideos.length > 1 && validDirectUrls.length > 1) {
        const totalBytes = resolvedVideos.reduce((acc, v) => acc + (v.filesizeBytes || 0), 0);
        formats.push({
          id: 'streamrizz_all_files_pack',
          label: `All Folder Videos (${resolvedVideos.length} Videos - Batch Pack)`,
          qualityTier: 'original',
          ext: 'mp4',
          filesizeBytes: totalBytes > 0 ? totalBytes : undefined,
          directUrl: validDirectUrls[0],
          isAlbumPack: true,
          allAlbumUrls: validDirectUrls,
          isVideo: true,
          headers: { Referer: 'https://streamrizz.com/' },
          badge: 'ALL IN FOLDER',
        });
      }

      // Individual video formats and media items
      const mediaItems = [];
      for (let i = 0; i < resolvedVideos.length; i++) {
        const v = resolvedVideos[i];
        const rawTitle = v.title || `Video_${v.id}.mp4`;
        const filename = rawTitle.toLowerCase().endsWith('.mp4') ? rawTitle : `${rawTitle}.mp4`;

        const fmt: StreamQualityFormat = {
          id: `streamrizz_video_${i}_${v.id}`,
          label: filename,
          customTitle: rawTitle,
          customFilename: filename,
          qualityTier: 'original',
          ext: 'mp4',
          filesizeBytes: v.filesizeBytes,
          directUrl: v.directUrl,
          headers: { Referer: 'https://streamrizz.com/' },
          isVideo: true,
          badge: inferVideoResolutionBadge(rawTitle),
          thumbnailUrl: v.thumbnailUrl,
        };

        formats.push(fmt);

        mediaItems.push({
          id: `streamrizz_item_${i}_${v.id}`,
          title: rawTitle,
          thumbnailUrl: v.thumbnailUrl,
          kind: 'video' as const,
          selectedFormatId: fmt.id,
          formats: [fmt],
        });
      }

      return {
        url: cleanUrl,
        platform: 'direct',
        platformName: 'StreamRizz Folder',
        title: folderTitle,
        thumbnailUrl: resolvedVideos[0]?.thumbnailUrl,
        description: `StreamRizz Folder containing ${resolvedVideos.length} videos.`,
        formats,
        mediaItems,
        selectedFormatId: formats[0]?.id || 'streamrizz_all_files_pack',
        totalItems: resolvedVideos.length,
        isDirectFile: true,
        resolvedAt: Date.now(),
      };
    } else if (isDirectVideo) {
      // 2. Single Video Resolution
      const idMatch = pathname.match(/\/(?:d|v|e)\/([a-zA-Z0-9_-]+)/);
      const videoId = idMatch ? idMatch[1] : pathname.split('/').filter(Boolean).pop() || '';
      const video = await resolveVideoDetail(videoId, undefined, undefined, signal);

      if (!video) {
        throw new Error('Failed to resolve StreamRizz video');
      }

      const filename = video.title.toLowerCase().endsWith('.mp4')
        ? video.title
        : `${video.title}.mp4`;

      const format: StreamQualityFormat = {
        id: `streamrizz_${video.id}`,
        label: filename,
        customTitle: video.title,
        customFilename: filename,
        qualityTier: 'original',
        ext: 'mp4',
        filesizeBytes: video.filesizeBytes,
        directUrl: video.directUrl,
        headers: { Referer: 'https://streamrizz.com/' },
        isVideo: true,
        badge: inferVideoResolutionBadge(video.title),
      };

      return {
        url: cleanUrl,
        platform: 'direct',
        platformName: 'StreamRizz Video',
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        formats: [format],
        selectedFormatId: format.id,
        isDirectFile: true,
        resolvedAt: Date.now(),
      };
    }

    return null;
  },
};
