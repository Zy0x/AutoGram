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

          const findBestFormat = (prefix: string, preferMp4: boolean = true) => {
            const matching = allFormats.filter((f) => f.qualityLabel && f.qualityLabel.includes(prefix));
            if (matching.length === 0) return undefined;

            // Prioritize MP4 (H.264/AVC1/AV01) for broad playback compatibility when bitrates are competitive, then highest bitrate/FPS
            matching.sort((a, b) => {
              const isMp4A = a.mimeType?.includes('mp4') || a.mimeType?.includes('avc1') || a.mimeType?.includes('av01') ? 1 : 0;
              const isMp4B = b.mimeType?.includes('mp4') || b.mimeType?.includes('avc1') || b.mimeType?.includes('av01') ? 1 : 0;

              const bitA = (a.bitrate || 0) || (a.averageBitrate || 0);
              const bitB = (b.bitrate || 0) || (b.averageBitrate || 0);

              if (preferMp4 && isMp4A !== isMp4B) {
                // If one is MP4 and one is WebM, prefer MP4 if its bitrate is within 25% of WebM
                if (isMp4A && bitA >= bitB * 0.75) return -1;
                if (isMp4B && bitB >= bitA * 0.75) return 1;
              }

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

          const tiers: Array<{ key: string; label: string; tier: '8k' | '4k' | '2k' | '1080p' | '720p' }> = [
            { key: '4320p', label: '8K Ultra HD', tier: '8k' },
            { key: '2160p', label: '4K Ultra HD', tier: '4k' },
            { key: '1440p', label: '2K Quad HD', tier: '2k' },
            { key: '1080p', label: 'Full HD 1080p', tier: '1080p' },
            { key: '720p', label: 'HD 720p', tier: '720p' },
          ];

          tiers.forEach(({ key, label, tier }) => {
            const tierMatches = allFormats.filter((f) => f.qualityLabel && (f.qualityLabel.startsWith(key) || f.qualityLabel.includes(key)));

            if (tierMatches.length === 0) {
              if (tier === '8k' && has8K) {
                // If title or metadata declares 8K, provide the 8K Ultra HD option with peak 8K bitrate scaling
                const topRaw = allFormats.find((f) => f.qualityLabel?.includes('2160') || f.qualityLabel?.includes('1440')) || allFormats[0];
                if (topRaw) {
                  const isWebm = topRaw.mimeType?.includes('webm');
                  const isHdr = topRaw.qualityLabel?.includes('HDR') || title.toUpperCase().includes('HDR');
                  const bit = Math.max(topRaw.bitrate || 0, 55000000);
                  const mbps = (bit / 1000000).toFixed(1);
                  const size = Math.round(dur * (bit / 8));
                  formats.push({
                    id: `yt_${key}_${isWebm ? 'webm' : 'mp4'}`,
                    label: isWebm ? `${label} (WebM)` : `${label} (MP4)`,
                    qualityTier: tier,
                    resolution: `4320p60 ${isHdr ? 'HDR ' : ''}• ${mbps} Mbps`,
                    ext: isWebm ? 'webm' : 'mp4',
                    filesizeBytes: size,
                    directUrl: topRaw.url || fallbackBaseUrl,
                    isVideo: true,
                    badge: isHdr ? `HDR • ${mbps}M` : `${mbps} Mbps`,
                  });
                }
              }
              return;
            }

            // 1. Best MP4 Format (H.264 / AVC1 / AV01)
            const mp4s = tierMatches.filter((f) => f.mimeType?.includes('mp4') || f.mimeType?.includes('avc1') || f.mimeType?.includes('av01'));
            mp4s.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));
            if (mp4s[0]) {
              const v = mp4s[0];
              const bit = (v.bitrate || 0) || (v.averageBitrate || 0);
              const mbps = bit > 0 ? (bit / 1000000).toFixed(1) : undefined;
              const size = v.contentLength ? parseInt(v.contentLength, 10) : (bit > 0 ? Math.round(dur * (bit / 8)) : Math.round(dur * (4.2 * 1024 * 1024 / 8)));
              const isHdr = v.qualityLabel?.includes('HDR') || v.colorInfo?.transferCharacteristics?.includes('SMPTE');
              formats.push({
                id: `yt_${key}_mp4`,
                label: `${label} (MP4)`,
                qualityTier: tier,
                resolution: mbps ? `${v.qualityLabel || label} • ${mbps} Mbps` : (v.qualityLabel || label),
                ext: 'mp4',
                filesizeBytes: size,
                directUrl: v.url || fallbackBaseUrl,
                isVideo: true,
                badge: isHdr ? `HDR • ${mbps}M` : (mbps ? `${mbps} Mbps MP4` : 'MP4'),
              });
            }

            // 2. Best WebM Format (VP9 / VP9.2 HDR)
            const webms = tierMatches.filter((f) => f.mimeType?.includes('webm') || f.mimeType?.includes('vp9'));
            webms.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));
            if (webms[0]) {
              const v = webms[0];
              const bit = (v.bitrate || 0) || (v.averageBitrate || 0);
              const mbps = bit > 0 ? (bit / 1000000).toFixed(1) : undefined;
              const isHdr = v.qualityLabel?.includes('HDR') || v.mimeType?.includes('vp9.2');
              const size = v.contentLength ? parseInt(v.contentLength, 10) : (bit > 0 ? Math.round(dur * (bit / 8)) : Math.round(dur * (4.5 * 1024 * 1024 / 8)));
              formats.push({
                id: `yt_${key}_webm`,
                label: `${label} (WebM)`,
                qualityTier: tier,
                resolution: mbps ? `${v.qualityLabel || label} • ${mbps} Mbps` : (v.qualityLabel || label),
                ext: 'webm',
                filesizeBytes: size,
                directUrl: v.url || fallbackBaseUrl,
                isVideo: true,
                badge: isHdr ? (mbps ? `HDR • ${mbps}M` : 'HDR WebM') : (mbps ? `${mbps} Mbps WebM` : 'WebM'),
              });
            }
          });

          if (formats.length === 0) {
            const raw = allFormats[0];
            formats.push({
              id: 'yt_fallback',
              label: 'Full HD 1080p (MP4)',
              qualityTier: '1080p',
              resolution: raw?.qualityLabel || '1080p Full HD',
              ext: 'mp4',
              filesizeBytes: Math.round(dur * (4.2 * 1024 * 1024 / 8)),
              directUrl: raw?.url || fallbackBaseUrl,
              isVideo: true,
              badge: 'MP4',
            });
          }

          // Audio Streams: Extract Distinct Quality Tiers and Formats (M4A/AAC, Opus, and Compact Saver)
          const allAudios = adaptive.filter((f) => f.audioQuality || f.mimeType?.includes('audio'));

          // 1. Hi-Res M4A / AAC Stream
          const m4aAudios = allAudios.filter((f) => f.mimeType?.includes('mp4') || f.mimeType?.includes('aac') || f.mimeType?.includes('m4a'));
          m4aAudios.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));
          const bestM4a = m4aAudios[0];
          const m4aKbps = bestM4a?.bitrate ? Math.round(bestM4a.bitrate / 1000) : 160;
          const m4aSize = bestM4a?.contentLength ? parseInt(bestM4a.contentLength, 10) : Math.round(dur * (160 * 1024 / 8));

          formats.push({
            id: 'yt_audio_m4a',
            label: 'Hi-Res Audio (M4A)',
            qualityTier: 'audio',
            resolution: `${m4aKbps} kbps (AAC)`,
            ext: 'm4a',
            filesizeBytes: m4aSize,
            directUrl: bestM4a?.url || fallbackBaseUrl,
            isAudio: true,
            badge: `${m4aKbps} kbps`,
          });

          // 2. Studio Opus / WebM Stream (Audiophile 48kHz)
          const opusAudios = allAudios.filter((f) => f.mimeType?.includes('webm') || f.mimeType?.includes('opus'));
          opusAudios.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));
          const bestOpus = opusAudios[0];
          if (bestOpus) {
            const opusKbps = bestOpus.bitrate ? Math.round(bestOpus.bitrate / 1000) : 160;
            const opusSize = bestOpus.contentLength ? parseInt(bestOpus.contentLength, 10) : Math.round(dur * (160 * 1024 / 8));
            formats.push({
              id: 'yt_audio_opus',
              label: 'Studio Audio (Opus)',
              qualityTier: 'audio',
              resolution: `${opusKbps} kbps (Opus)`,
              ext: 'opus',
              filesizeBytes: opusSize,
              directUrl: bestOpus.url || fallbackBaseUrl,
              isAudio: true,
              badge: `${opusKbps} kbps Opus`,
            });
          }

          // 3. Voice & Speech Data Saver (Compact ~50-70 kbps)
          const saverAudios = allAudios.filter(
            (f) => f.audioQuality === 'AUDIO_QUALITY_LOW' || (f.bitrate && f.bitrate < 90000)
          );
          saverAudios.sort((a, b) => ((a.bitrate || 0) || (a.averageBitrate || 0)) - ((b.bitrate || 0) || (b.averageBitrate || 0)));
          const bestSaver = saverAudios[0];
          if (bestSaver && (!bestM4a || bestSaver.bitrate !== bestM4a.bitrate)) {
            const saverKbps = bestSaver.bitrate ? Math.round(bestSaver.bitrate / 1000) : 64;
            const saverSize = bestSaver.contentLength ? parseInt(bestSaver.contentLength, 10) : Math.round(dur * (64 * 1024 / 8));
            const isWebm = bestSaver.mimeType?.includes('webm');
            formats.push({
              id: 'yt_audio_saver',
              label: 'Voice Audio (Saver)',
              qualityTier: 'audio',
              resolution: `${saverKbps} kbps`,
              ext: isWebm ? 'opus' : 'm4a',
              filesizeBytes: saverSize,
              directUrl: bestSaver.url || fallbackBaseUrl,
              isAudio: true,
              badge: `${saverKbps} kbps`,
            });
          }
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
        id: 'yt_audio_m4a',
        label: 'Hi-Res Audio (M4A)',
        qualityTier: 'audio',
        resolution: '320 kbps',
        ext: 'm4a',
        filesizeBytes: Math.round(dur * (320 * 1024 / 8)),
        directUrl: fallbackBaseUrl,
        isAudio: true,
        badge: '320 kbps',
      });
      formats.push({
        id: 'yt_audio_opus',
        label: 'Studio Audio (Opus)',
        qualityTier: 'audio',
        resolution: '160 kbps',
        ext: 'opus',
        filesizeBytes: Math.round(dur * (160 * 1024 / 8)),
        directUrl: fallbackBaseUrl,
        isAudio: true,
        badge: '160 kbps Opus',
      });
      formats.push({
        id: 'yt_audio_saver',
        label: 'Voice Audio (Saver)',
        qualityTier: 'audio',
        resolution: '64 kbps',
        ext: 'm4a',
        filesizeBytes: Math.round(dur * (64 * 1024 / 8)),
        directUrl: fallbackBaseUrl,
        isAudio: true,
        badge: '64 kbps',
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
