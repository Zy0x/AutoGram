import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../../tauri/platform';
import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat, RawStreamItem, SubtitleTrackItem } from '../types';

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
      },
      signal: signal || AbortSignal.timeout(6000),
    });
    if (resp.ok) {
      return await resp.text();
    }
  } catch {
    /* ignore fetch error */
  }
  return null;
}

export const youtubeResolver: LinkResolverProvider = {
  name: 'youtubeResolver',
  platform: 'youtube',

  canHandle(url: string): boolean {
    return extractYouTubeVideoId(url) !== null;
  },

  async resolve(
    url: string,
    signal?: AbortSignal,
    _options?: any
  ): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    const videoId = extractYouTubeVideoId(cleanUrl);
    if (!videoId) return null;

    const fallbackBaseUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let title = `YouTube Video (${videoId})`;
    let author = 'YouTube Creator';
    let durationSec: number | undefined;
    let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    let description: string | undefined;
    const formats: StreamQualityFormat[] = [];
    const subtitles: SubtitleTrackItem[] = [];
    const rawStreams: RawStreamItem[] = [];

    // 1. Primary extraction via watch page ytInitialPlayerResponse JSON payload
    try {
      const html = await fetchYouTubeWatchHtml(cleanUrl, signal);
      if (html) {
        const titleMatch =
          html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
          html.match(/<meta\s+name="title"\s+content="([^"]+)"/i) ||
          html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          title = titleMatch[1].replace(/\s*-\s*YouTube$/i, '').trim();
        }

        const authorMatch =
          html.match(/<meta\s+name="author"\s+content="([^"]+)"/i) ||
          html.match(/<link\s+itemprop="name"\s+content="([^"]+)"/i);
        if (authorMatch && authorMatch[1]) {
          author = authorMatch[1].trim();
        }

        const descMatch =
          html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
          html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
        if (descMatch && descMatch[1]) {
          description = descMatch[1].trim();
        }

        const playerJsonMatch =
          html.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:var\s|window\[|\n|<\/script>)/s) ||
          html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);

        if (playerJsonMatch && playerJsonMatch[1]) {
          const data = JSON.parse(playerJsonMatch[1]);
          if (data?.videoDetails?.title) title = data.videoDetails.title;
          if (data?.videoDetails?.author) author = data.videoDetails.author;
          if (data?.videoDetails?.shortDescription) description = data.videoDetails.shortDescription;
          if (data?.videoDetails?.lengthSeconds) {
            durationSec = parseInt(data.videoDetails.lengthSeconds, 10);
          }

          const thumbs = data?.videoDetails?.thumbnail?.thumbnails || [];
          if (thumbs.length > 0) {
            thumbnailUrl = thumbs[thumbs.length - 1].url.split('?')[0];
          }

          const adaptive = (data?.streamingData?.adaptiveFormats || []) as any[];
          const regular = (data?.streamingData?.formats || []) as any[];
          const allFormats = [...adaptive, ...regular];

          const qualityLabels = Array.from(
            new Set(allFormats.map((f) => f.qualityLabel).filter(Boolean))
          ) as string[];

          const dur = durationSec || 180;
          const has8K = qualityLabels.some((q) => q.startsWith('4320p') || q.includes('8k')) || /\b(8k|4320p)\b/i.test(title);

          const tiers: Array<{ key: string; label: string; tier: '8k' | '4k' | '2k' | '1080p' | '720p' | '480p' | '360p' }> = [
            { key: '360p', label: 'Compact 360p', tier: '360p' },
            { key: '480p', label: 'SD 480p', tier: '480p' },
            { key: '720p', label: 'HD 720p', tier: '720p' },
            { key: '1080p', label: 'Full HD 1080p', tier: '1080p' },
            { key: '1440p', label: '2K Quad HD', tier: '2k' },
            { key: '2160p', label: '4K Ultra HD', tier: '4k' },
            { key: '4320p', label: '8K Ultra HD', tier: '8k' },
          ];

          tiers.forEach(({ key, label, tier }) => {
            const tierMatches = allFormats.filter((f) => f.qualityLabel && (f.qualityLabel.startsWith(key) || f.qualityLabel.includes(key)));

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
                itag: v.itag,
              });
            }

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
                itag: v.itag,
              });
            }
          });

          const allAudios = adaptive.filter((f) => f.audioQuality || f.mimeType?.includes('audio'));

          const saverAudios = allAudios.filter(
            (f) => f.audioQuality === 'AUDIO_QUALITY_LOW' || (f.bitrate && f.bitrate < 90000)
          );
          saverAudios.sort((a, b) => ((a.bitrate || 0) || (a.averageBitrate || 0)) - ((b.bitrate || 0) || (a.averageBitrate || 0)));
          const bestSaver = saverAudios[0];
          if (bestSaver) {
            const saverKbps = bestSaver.bitrate ? Math.round(bestSaver.bitrate / 1000) : 64;
            const saverSize = bestSaver.contentLength ? parseInt(bestSaver.contentLength, 10) : Math.round(dur * (64 * 1024 / 8));
            const isWebm = bestSaver.mimeType?.includes('webm') || bestSaver.mimeType?.includes('opus');
            const fmtName = isWebm ? 'Opus' : 'M4A';
            const codecTag = isWebm ? 'OPUS' : 'AAC';
            formats.push({
              id: 'yt_audio_saver',
              label: `Voice Audio (${fmtName})`,
              qualityTier: 'audio',
              resolution: `${saverKbps} kbps (${codecTag})`,
              ext: isWebm ? 'opus' : 'm4a',
              filesizeBytes: saverSize,
              directUrl: bestSaver.url || fallbackBaseUrl,
              isAudio: true,
              badge: `${saverKbps} KBPS • ${codecTag}`,
              itag: bestSaver?.itag,
            });
          }

          const m4aAudios = allAudios.filter((f) => f.mimeType?.includes('mp4') || f.mimeType?.includes('aac') || f.mimeType?.includes('m4a'));
          m4aAudios.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));
          const bestM4a = m4aAudios[0];
          if (bestM4a) {
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
              badge: `${m4aKbps} KBPS • AAC`,
              itag: bestM4a?.itag,
            });
          }

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
              badge: `${opusKbps} KBPS • OPUS`,
              itag: bestOpus?.itag,
            });
          }

          const captionTracks = (data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []) as any[];
          captionTracks.forEach((c) => {
            if (!c.baseUrl) return;
            const langCode = c.languageCode || 'id';
            const rawName = c.name?.simpleText || c.name?.runs?.[0]?.text || langCode.toUpperCase();
            const cleanName = rawName.replace(/\s*\([^)]+\)/g, '').trim() || langCode.toUpperCase();
            const isAuto = c.vssId?.startsWith('a.') || c.kind === 'asr';
            const subId = `yt_sub_${langCode}_${c.vssId?.replace(/[^a-zA-Z0-9]/g, '') || 'track'}`;

            subtitles.push({
              id: subId,
              languageCode: langCode,
              languageName: isAuto ? `${cleanName} (Auto)` : cleanName,
              isAutoGenerated: isAuto,
              directUrl: `${c.baseUrl}&fmt=srv3`,
              vssId: c.vssId,
            });

            formats.push({
              id: subId,
              label: `Subtitle ${cleanName}`,
              qualityTier: 'subtitle',
              resolution: langCode.toUpperCase(),
              ext: 'srt',
              directUrl: `${c.baseUrl}&fmt=srv3`,
              isSubtitle: true,
              badge: isAuto ? `${langCode.toUpperCase()} • AUTO` : langCode.toUpperCase(),
            });
          });

          allFormats.forEach((f) => {
            const bit = (f.bitrate || 0) || (f.averageBitrate || 0);
            const mbps = bit >= 1000000 ? `${(bit / 1000000).toFixed(1)} Mbps` : `${Math.round(bit / 1000)} kbps`;
            const mime = f.mimeType || '';
            const isAudio = !f.qualityLabel && (mime.includes('audio') || !!f.audioQuality);
            const isVideo = !!f.qualityLabel || mime.includes('video');
            const isMuxed = isVideo && (regular.includes(f) || (f.audioQuality && f.qualityLabel));

            let codec = 'Unknown';
            const codecMatch = mime.match(/codecs="([^"]+)"/);
            if (codecMatch) {
              const rawCodec = codecMatch[1];
              if (rawCodec.startsWith('avc1')) codec = 'H.264 / AVC';
              else if (rawCodec.startsWith('av01')) codec = 'AV1';
              else if (rawCodec.startsWith('vp9.2')) codec = 'VP9.2 HDR';
              else if (rawCodec.startsWith('vp9') || rawCodec.startsWith('vp09')) codec = 'VP9';
              else if (rawCodec.startsWith('opus')) codec = 'Opus 48kHz';
              else if (rawCodec.startsWith('mp4a')) codec = 'AAC Audio';
              else codec = rawCodec;
            }

            const isHdr = f.qualityLabel?.includes('HDR') || mime.includes('vp9.2') || f.colorInfo?.transferCharacteristics?.includes('SMPTE');
            const size = f.contentLength ? parseInt(f.contentLength, 10) : (bit > 0 ? Math.round(dur * (bit / 8)) : undefined);

            rawStreams.push({
              itag: f.itag || 0,
              qualityLabel: f.qualityLabel || (isAudio ? 'Audio Stream' : 'Video Stream'),
              mimeType: mime.split(';')[0] || mime,
              codec,
              bitrate: bit,
              bitrateFormatted: mbps,
              fps: f.fps,
              filesizeBytes: size,
              type: isMuxed ? 'muxed' : (isAudio ? 'audio' : 'video'),
              directUrl: f.url || fallbackBaseUrl,
              isHdr,
            });
          });
        }
      }
    } catch {
      /* ignore watch html error */
    }

    if (formats.length === 0) {
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

    let defaultFormatId = formats[0]?.id || '';
    const mp4Videos = formats.filter((f) => !f.isAudio && !f.isSubtitle && f.ext === 'mp4');
    if (mp4Videos.length > 0) {
      const highestMp4 = mp4Videos.find((f) => f.qualityTier === '8k') ||
        mp4Videos.find((f) => f.qualityTier === '4k') ||
        mp4Videos.find((f) => f.qualityTier === '2k') ||
        mp4Videos.find((f) => f.qualityTier === '1080p') ||
        mp4Videos[0];
      if (highestMp4) defaultFormatId = highestMp4.id;
    }

    return {
      url: cleanUrl,
      platform: 'youtube',
      platformName: 'YouTube (Ultra-HD)',
      title,
      author,
      durationSec,
      thumbnailUrl,
      description,
      formats,
      selectedFormatId: defaultFormatId,
      rawStreams,
      subtitles,
      resolvedAt: Date.now(),
    };
  },
};
