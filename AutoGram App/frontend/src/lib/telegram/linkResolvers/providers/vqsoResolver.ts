import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../../tauri/platform';
import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';
import { assertSafeRemoteUrl } from '../urlSafety';

const VQSO_HOSTS = /(^|\.)(vqso\.(?:de|com|net|org)|slicedrive\.(?:com|net|org)|slc\.is)$/i;

function isVqsoHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return VQSO_HOSTS.test(host);
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

function parsePlayerConfig(base64Str: string): any | null {
  try {
    const normalized = base64Str.trim().replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = atob(normalized);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * vqso.de & SliceDrive Link Resolver
 * Detects embedded videos on vqso.de and extracts direct high-speed CDN MP4 streams.
 */
export const vqsoResolver: LinkResolverProvider = {
  name: 'VqsoResolver',
  platform: 'direct',

  canHandle(url: string): boolean {
    return isVqsoHost(url);
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    assertSafeRemoteUrl(cleanUrl);

    const html = await fetchRemoteHtml(cleanUrl, signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // Extract title from HTML or fallback to slug
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].replace(/ · vqso\.de$/i, '').trim() : '';

    // Extract playerConfig base64
    const configMatch = html.match(/<script type="text\/plain" id="playerConfig">([^<]+)<\/script>/i);
    if (!configMatch) {
      // Fallback: look for direct mp4 in scripts
      const directMatch = html.match(/https?:\/\/[^"'\s]+\.mp4/i);
      if (directMatch) {
        const directUrl = directMatch[0];
        const filename = `Video_${Date.now()}.mp4`;
        const size = await probeContentLength(directUrl);
        const format: StreamQualityFormat = {
          id: 'vqso_direct',
          label: filename,
          customTitle: title || filename,
          customFilename: filename,
          qualityTier: 'original',
          ext: 'mp4',
          filesizeBytes: size,
          directUrl,
          isVideo: true,
          badge: '1080p FHD',
        };
        return {
          url: cleanUrl,
          platform: 'direct',
          platformName: 'vqso.de Video',
          title: title || filename,
          formats: [format],
          selectedFormatId: format.id,
          isDirectFile: true,
          resolvedAt: Date.now(),
        };
      }
      throw new Error('Failed to extract video configuration from vqso.de');
    }

    const config = parsePlayerConfig(configMatch[1]);
    if (!config) {
      throw new Error('Invalid player configuration on vqso.de');
    }

    const directUrl = config.videoSrcClean || config.videoSrcPreview;
    if (!directUrl || !directUrl.startsWith('http')) {
      throw new Error('No valid direct video stream found on vqso.de');
    }

    const slug = config.slug || cleanUrl.split('/').filter(Boolean).pop() || 'video';
    const filename = title && title !== 'Watch' ? `${title}.mp4` : `vqso_${slug}.mp4`;
    const cleanDisplayTitle = title && title !== 'Watch' ? title : `Video ${slug}`;

    const filesizeBytes = await probeContentLength(directUrl);
    const thumbnailUrl = config.videoSrcPreview?.includes('#t=')
      ? undefined
      : config.thumbnailUrl || undefined;

    const format: StreamQualityFormat = {
      id: `vqso_${slug}`,
      label: filename,
      customTitle: cleanDisplayTitle,
      customFilename: filename,
      qualityTier: 'original',
      ext: 'mp4',
      filesizeBytes,
      directUrl,
      isVideo: true,
      badge: '1080p FULL HD',
    };

    return {
      url: cleanUrl,
      platform: 'direct',
      platformName: 'vqso.de Video',
      title: cleanDisplayTitle,
      thumbnailUrl,
      formats: [format],
      selectedFormatId: format.id,
      isDirectFile: true,
      resolvedAt: Date.now(),
    };
  },
};
