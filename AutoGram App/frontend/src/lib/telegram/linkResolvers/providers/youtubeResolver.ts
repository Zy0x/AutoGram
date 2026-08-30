import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../../tauri/platform';
import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';

/**
 * Extract YouTube Video ID from standard, short, or embedded URLs.
 */
export function extractYouTubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i);
  return match ? match[1] : null;
}

async function fetchYouTubeWatchHtml(url: string, signal?: AbortSignal): Promise<string | null> {
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

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: signal || AbortSignal.timeout(6000),
    });
    if (resp.ok) return await resp.text();
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * YouTube Ultra-HD Smart Resolver (8K, 4K, 2K, 1080p60, 720p, Hi-Res Audio)
 */
export const youtubeResolver: LinkResolverProvider = {
  name: 'YouTubeResolver',
  platform: 'youtube',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return u.includes('youtube.com') || u.includes('youtu.be');
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    const videoId = extractYouTubeVideoId(cleanUrl);

    if (!videoId) {
      return null;
    }

    let title = `YouTube_Video_${videoId}`;
    let author: string | undefined;
    let durationSec: number | undefined;
    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    const fallbackBaseUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const formats: StreamQualityFormat[] = [];

    // 1. Primary Direct Inspection: Fetch YouTube Watch Page HTML via Tauri/Native fetch to parse exact ytInitialPlayerResponse
    try {
      const html = await fetchYouTubeWatchHtml(`https://www.youtube.com/watch?v=${videoId}`, signal);

      if (html) {
        const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (match && match[1]) {
          const data = JSON.parse(match[1]);
          const videoDetails = data?.videoDetails;
          if (videoDetails?.title) title = videoDetails.title;
          if (videoDetails?.author) author = videoDetails.author;
          if (videoDetails?.lengthSeconds) {
            durationSec = parseInt(videoDetails.lengthSeconds, 10);
          }

          const adaptive = (data?.streamingData?.adaptiveFormats || []) as any[];
          const regular = (data?.streamingData?.formats || []) as any[];
          const allFormats = [...adaptive, ...regular];

          const qualityLabels = Array.from(
            new Set(allFormats.map((f) => f.qualityLabel).filter(Boolean))
          ) as string[];

          const findBestFormat = (prefix: string) => {
            const matching = allFormats.filter((f) => f.qualityLabel && f.qualityLabel.includes(prefix));
            if (matching.length === 0) return undefined;

            // Prioritize highest bitrate, then highest content length, then highest fps (60fps/HDR/Premium)
            matching.sort((a, b) => {
              const bitA = (a.bitrate || 0) || (a.averageBitrate || 0);
              const bitB = (b.bitrate || 0) || (b.averageBitrate || 0);
              if (bitB !== bitA) return bitB - bitA;
              const lenA = a.contentLength ? parseInt(a.contentLength, 10) : 0;
              const lenB = b.contentLength ? parseInt(b.contentLength, 10) : 0;
              if (lenB !== lenA) return lenB - lenA;
              const fpsA = a.fps || 0;
              const fpsB = b.fps || 0;
              return fpsB - fpsA;
            });

            return matching[0];
          };

          const dur = durationSec || 180;
          const has8K = qualityLabels.some((q) => q.startsWith('4320p') || q.includes('8k')) || /\b(8k|4320p)\b/i.test(title);
          const has4K = has8K || qualityLabels.some((q) => q.startsWith('2160p') || q.includes('4k')) || /\b(4k|2160p|uhd)\b/i.test(title);
          const has2K = has4K || qualityLabels.some((q) => q.startsWith('1440p') || q.includes('2k') || q.includes('1440')) || /\b(2k|1440p|qhd)\b/i.test(title);

          // 8K (4320p)
          if (has8K) {
            const raw = findBestFormat('4320p');
            const size = raw?.contentLength ? parseInt(raw.contentLength, 10) : Math.round(dur * (50 * 1024 * 1024 / 8));
            const isWebm = raw?.mimeType?.includes('webm');
            formats.push({
              id: 'yt_8k',
              label: '8K Ultra HD',
              qualityTier: '8k',
              resolution: raw?.qualityLabel || '4320p (8K)',
              ext: isWebm ? 'webm' : 'mp4',
              filesizeBytes: size,
              directUrl: raw?.url || fallbackBaseUrl,
              isVideo: true,
              badge: raw?.qualityLabel?.includes('HDR') ? '8K HDR' : (raw?.qualityLabel?.includes('60') ? '8K 60fps' : '4320p'),
            });
          }

          // 4K (2160p)
          if (has4K) {
            const raw = findBestFormat('2160p');
            const size = raw?.contentLength ? parseInt(raw.contentLength, 10) : Math.round(dur * (20 * 1024 * 1024 / 8));
            const isWebm = raw?.mimeType?.includes('webm');
            formats.push({
              id: 'yt_4k',
              label: '4K Ultra HD',
              qualityTier: '4k',
              resolution: raw?.qualityLabel || '2160p (4K)',
              ext: isWebm ? 'webm' : 'mp4',
              filesizeBytes: size,
              directUrl: raw?.url || fallbackBaseUrl,
              isVideo: true,
              badge: raw?.qualityLabel?.includes('HDR') ? '4K HDR' : (raw?.qualityLabel?.includes('60') ? '4K 60fps' : '2160p'),
            });
          }

          // 2K QHD (1440p)
          if (has2K) {
            const raw = findBestFormat('1440p');
            const size = raw?.contentLength ? parseInt(raw.contentLength, 10) : Math.round(dur * (9 * 1024 * 1024 / 8));
            const isWebm = raw?.mimeType?.includes('webm');
            formats.push({
              id: 'yt_2k',
              label: '2K Quad HD',
              qualityTier: '2k',
              resolution: raw?.qualityLabel || '1440p (2K)',
              ext: isWebm ? 'webm' : 'mp4',
              filesizeBytes: size,
              directUrl: raw?.url || fallbackBaseUrl,
              isVideo: true,
              badge: raw?.qualityLabel?.includes('HDR') ? '2K HDR' : (raw?.qualityLabel?.includes('60') ? '2K 60fps' : '1440p'),
            });
          }

          // Full HD (1080p)
          if (qualityLabels.some((q) => q.startsWith('1080p') || q.includes('1080')) || formats.length === 0) {
            const raw = findBestFormat('1080p');
            const size = raw?.contentLength ? parseInt(raw.contentLength, 10) : Math.round(dur * (4.2 * 1024 * 1024 / 8));
            const isWebm = raw?.mimeType?.includes('webm');
            formats.push({
              id: 'yt_1080p',
              label: 'Full HD 1080p',
              qualityTier: '1080p',
              resolution: raw?.qualityLabel || '1080p Full HD',
              ext: isWebm ? 'webm' : 'mp4',
              filesizeBytes: size,
              directUrl: raw?.url || fallbackBaseUrl,
              isVideo: true,
              badge: raw?.qualityLabel?.includes('HDR') ? '1080p HDR' : (raw?.qualityLabel?.includes('60') ? '60fps' : '1080p'),
            });
          }

          // HD 720p
          if (qualityLabels.some((q) => q.startsWith('720p') || q.includes('720'))) {
            const raw = findBestFormat('720p');
            const size = raw?.contentLength ? parseInt(raw.contentLength, 10) : Math.round(dur * (2.1 * 1024 * 1024 / 8));
            const isWebm = raw?.mimeType?.includes('webm');
            formats.push({
              id: 'yt_720p',
              label: 'HD 720p',
              qualityTier: '720p',
              resolution: raw?.qualityLabel || '720p HD',
              ext: isWebm ? 'webm' : 'mp4',
              filesizeBytes: size,
              directUrl: raw?.url || fallbackBaseUrl,
              isVideo: true,
              badge: raw?.qualityLabel?.includes('HDR') ? '720p HDR' : (raw?.qualityLabel?.includes('60') ? '720p 60fps' : '720p'),
            });
          }

          // Audio Only (Highest Bitrate Audio Stream)
          const audioFormats = adaptive.filter((f) => f.audioQuality || f.mimeType?.includes('audio'));
          audioFormats.sort((a, b) => {
            const bitA = (a.bitrate || 0) || (a.averageBitrate || 0);
            const bitB = (b.bitrate || 0) || (b.averageBitrate || 0);
            if (bitB !== bitA) return bitB - bitA;
            const lenA = a.contentLength ? parseInt(a.contentLength, 10) : 0;
            const lenB = b.contentLength ? parseInt(b.contentLength, 10) : 0;
            return lenB - lenA;
          });
          const bestAudio = audioFormats[0];
          const audioSize = bestAudio?.contentLength
            ? parseInt(bestAudio.contentLength, 10)
            : Math.round(dur * (320 * 1024 / 8));
          const audioKbps = bestAudio?.bitrate ? Math.round(bestAudio.bitrate / 1000) : 320;
          formats.push({
            id: 'yt_audio',
            label: 'Hi-Res Audio',
            qualityTier: 'audio',
            resolution: `${audioKbps} kbps`,
            ext: bestAudio?.mimeType?.includes('mp4') ? 'm4a' : 'mp3',
            filesizeBytes: audioSize,
            directUrl: bestAudio?.url || fallbackBaseUrl,
            isAudio: true,
            badge: `${audioKbps} kbps`,
          });
        }
      }
    } catch {
      /* ignore watch html error */
    }

    // 2. Secondary fallback via YouTube oEmbed if watch html didn't resolve metadata
    if (formats.length === 0) {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const oembedResp = await fetch(oembedUrl, {
          signal: signal || AbortSignal.timeout(4000),
        });
        if (oembedResp.ok) {
          const info = await oembedResp.json();
          if (info.title) title = info.title;
          if (info.author_name) author = info.author_name;
        }
      } catch {
        /* ignore oembed error */
      }

      const dur = durationSec || 180;
      const is8K = /\b(8k|4320p)\b/i.test(title);
      const is4K = is8K || /\b(4k|2160p|uhd)\b/i.test(title);
      const is2K = is4K || /\b(2k|1440p|qhd)\b/i.test(title);

      if (is8K) {
        formats.push({
          id: 'yt_8k',
          label: '8K Ultra HD',
          qualityTier: '8k',
          resolution: '4320p (8K)',
          ext: 'mp4',
          filesizeBytes: Math.round(dur * (50 * 1024 * 1024 / 8)),
          directUrl: fallbackBaseUrl,
          isVideo: true,
          badge: '4320p',
        });
      }
      if (is4K) {
        formats.push({
          id: 'yt_4k',
          label: '4K Ultra HD',
          qualityTier: '4k',
          resolution: '2160p (4K)',
          ext: 'mp4',
          filesizeBytes: Math.round(dur * (20 * 1024 * 1024 / 8)),
          directUrl: fallbackBaseUrl,
          isVideo: true,
          badge: '2160p',
        });
      }
      if (is2K) {
        formats.push({
          id: 'yt_2k',
          label: '2K Quad HD',
          qualityTier: '2k',
          resolution: '1440p (2K)',
          ext: 'mp4',
          filesizeBytes: Math.round(dur * (9 * 1024 * 1024 / 8)),
          directUrl: fallbackBaseUrl,
          isVideo: true,
          badge: '1440p',
        });
      }

      formats.push({
        id: 'yt_1080p',
        label: 'Full HD 1080p',
        qualityTier: '1080p',
        resolution: '1080p Full HD',
        ext: 'mp4',
        filesizeBytes: Math.round(dur * (4.2 * 1024 * 1024 / 8)),
        directUrl: fallbackBaseUrl,
        isVideo: true,
        badge: '1080p',
      });
      formats.push({
        id: 'yt_720p',
        label: 'HD 720p',
        qualityTier: '720p',
        resolution: '720p HD',
        ext: 'mp4',
        filesizeBytes: Math.round(dur * (2.1 * 1024 * 1024 / 8)),
        directUrl: fallbackBaseUrl,
        isVideo: true,
        badge: '720p',
      });
      formats.push({
        id: 'yt_audio',
        label: 'Hi-Res Audio',
        qualityTier: 'audio',
        resolution: '320 kbps',
        ext: 'mp3',
        filesizeBytes: Math.round(dur * (320 * 1024 / 8)),
        directUrl: fallbackBaseUrl,
        isAudio: true,
        badge: '320 kbps',
      });
    }

    return {
      url: cleanUrl,
      platform: 'youtube',
      platformName: 'YouTube (Ultra-HD)',
      title,
      author,
      durationSec,
      thumbnailUrl,
      formats,
      selectedFormatId: formats.find((f) => f.qualityTier === '1080p')?.id || formats[0].id,
      resolvedAt: Date.now(),
    };
  },
};
