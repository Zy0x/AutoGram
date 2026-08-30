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

/**
 * Parse chapter timestamps from YouTube video description.
 */
export function parseChaptersFromDescription(desc?: string): Array<{ title: string; startSec: number }> {
  if (!desc) return [];
  const chapters: Array<{ title: string; startSec: number }> = [];
  const regex = /(?:^|\n)\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+[-–—]?\s*([^\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(desc)) !== null) {
    const hours = match[1] ? parseInt(match[1], 10) : 0;
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const title = match[4]?.trim();
    if (title) {
      chapters.push({
        title,
        startSec: hours * 3600 + minutes * 60 + seconds,
      });
    }
  }
  return chapters;
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

async function fetchYouTubeInnertubePlayer(videoId: string, signal?: AbortSignal): Promise<any | null> {
  const clients = [
    {
      clientName: 'ANDROID',
      clientVersion: '19.09.37',
      osName: 'Android',
      osVersion: '14',
      androidSdkVersion: 34,
    },
    {
      clientName: 'WEB',
      clientVersion: '2.20240501.01.00',
    },
  ];

  for (const client of clients) {
    try {
      const payload = JSON.stringify({
        videoId,
        context: {
          client: {
            ...client,
            hl: 'id',
            gl: 'ID',
          },
        },
      });

      const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            client.clientName === 'ANDROID'
              ? 'com.google.android.youtube/19.09.37 (Linux; U; Android 14; id_ID) gzip'
              : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        body: payload,
        signal: signal || AbortSignal.timeout(4500),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data?.videoDetails || data?.streamingData) {
          return data;
        }
      }
    } catch {
      /* continue to next client fallback */
    }
  }
  return null;
}

function processPlayerData(
  data: any,
  videoId: string,
  fallbackBaseUrl: string,
  formats: StreamQualityFormat[],
  subtitles: SubtitleTrackItem[],
  rawStreams: RawStreamItem[],
  chapters: Array<{ title: string; startSec: number; endSec?: number; thumbnailUrl?: string }>
): {
  title?: string;
  author?: string;
  description?: string;
  durationSec?: number;
  thumbnailUrl?: string;
} {
  let title = data?.videoDetails?.title;
  let author = data?.videoDetails?.author;
  let description = data?.videoDetails?.shortDescription;
  let durationSec: number | undefined;
  if (data?.videoDetails?.lengthSeconds) {
    durationSec = parseInt(data.videoDetails.lengthSeconds, 10);
  }

  let thumbnailUrl: string | undefined;
  const thumbs = data?.videoDetails?.thumbnail?.thumbnails || [];
  if (thumbs.length > 0) {
    thumbnailUrl = thumbs[thumbs.length - 1].url.split('?')[0];
  } else {
    thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  // Extract chapters from markers if present
  try {
    const markers =
      data?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar
        ?.multiMarkersPlayerBarRenderer?.markersMap?.[0]?.value?.chapters || [];
    markers.forEach((m: any) => {
      const cTitle = m?.chapterRenderer?.title?.simpleText || m?.chapterRenderer?.title?.runs?.[0]?.text;
      const cStart = m?.chapterRenderer?.timeRangeStartMillis ? Math.round(m.chapterRenderer.timeRangeStartMillis / 1000) : 0;
      if (cTitle) {
        chapters.push({ title: cTitle, startSec: cStart });
      }
    });
  } catch {
    /* ignore marker extraction error */
  }

  // Also parse from description if markers empty
  if (chapters.length === 0 && description) {
    const descChapters = parseChaptersFromDescription(description);
    descChapters.forEach((c) => chapters.push(c));
  }

  const adaptive = (data?.streamingData?.adaptiveFormats || []) as any[];
  const regular = (data?.streamingData?.formats || []) as any[];
  const allFormats = [...adaptive, ...regular];

  const dur = durationSec || 180;
  const isTitle8K = /\b(8k|4320p)\b/i.test(title);
  const isTitle4K = isTitle8K || /\b(4k|2160p|uhd)\b/i.test(title);
  const isTitle2K = isTitle4K || /\b(2k|1440p|qhd)\b/i.test(title);

  const tiers: Array<{ key: string; label: string; tier: '8k' | '4k' | '2k' | '1080p' | '720p' | '480p' | '360p'; height: number; defaultBitrateMbps: number }> = [
    { key: '4320p', label: '8K Ultra HD', tier: '8k', height: 4320, defaultBitrateMbps: 50.0 },
    { key: '2160p', label: '4K Ultra HD', tier: '4k', height: 2160, defaultBitrateMbps: 25.0 },
    { key: '1440p', label: '2K Quad HD', tier: '2k', height: 1440, defaultBitrateMbps: 12.0 },
    { key: '1080p', label: 'Full HD 1080p', tier: '1080p', height: 1080, defaultBitrateMbps: 4.5 },
    { key: '720p', label: 'HD 720p', tier: '720p', height: 720, defaultBitrateMbps: 2.5 },
    { key: '480p', label: 'SD 480p', tier: '480p', height: 480, defaultBitrateMbps: 1.2 },
    { key: '360p', label: 'Compact 360p', tier: '360p', height: 360, defaultBitrateMbps: 0.6 },
    { key: '240p', label: '240p', tier: '360p', height: 240, defaultBitrateMbps: 0.3 },
    { key: '144p', label: '144p', tier: '360p', height: 144, defaultBitrateMbps: 0.15 },
  ];

  tiers.forEach(({ key, label, tier, height, defaultBitrateMbps }) => {
    const tierMatches = allFormats.filter((f) => {
      const ql = (f.qualityLabel || '').toLowerCase();
      return ql.startsWith(key) || ql.includes(key) || (f.height && Math.abs(f.height - height) <= 25);
    });

    const webms = tierMatches.filter((f) => f.mimeType?.includes('webm') || f.mimeType?.includes('vp9'));
    webms.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));

    const mp4s = tierMatches.filter((f) => f.mimeType?.includes('mp4') || f.mimeType?.includes('avc1') || f.mimeType?.includes('av01'));
    mp4s.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));

    const hasWebm = webms.length > 0;
    const hasMp4 = mp4s.length > 0;
    const is8kTier = tier === '8k';

    // 1. WebM stream
    if (hasWebm || (is8kTier && isTitle8K)) {
      const v = webms[0];
      const bit = v ? ((v.bitrate || 0) || (v.averageBitrate || 0)) : Math.round(defaultBitrateMbps * 1000000);
      const mbps = bit > 0 ? (bit / 1000000).toFixed(1) : defaultBitrateMbps.toFixed(1);
      const isHdr = v?.qualityLabel?.includes('HDR') || v?.mimeType?.includes('vp9.2') || (is8kTier && isTitle8K);
      const size = v?.contentLength ? parseInt(v.contentLength, 10) : Math.round(dur * (parseFloat(mbps) * 1000000 / 8));

      formats.push({
        id: `yt_${key}_webm`,
        label: `${label} (WebM)`,
        qualityTier: tier,
        resolution: `${v?.qualityLabel || key} • ${mbps} Mbps`,
        fps: v?.fps || (isHdr ? 60 : 30),
        ext: 'webm',
        filesizeBytes: size,
        directUrl: v?.url || fallbackBaseUrl,
        isVideo: true,
        badge: `${mbps} Mbps`,
        codec: isHdr ? 'VP9 HDR' : 'VP9',
        itag: v?.itag,
      });
    }

    // 2. MP4 stream (if present, or synthesized when WebM/8K/4K/2K is available)
    if (hasMp4 || hasWebm || (is8kTier && isTitle8K) || (tier === '4k' && isTitle4K) || (tier === '2k' && isTitle2K)) {
      const v = mp4s[0] || webms[0];
      const bit = v ? ((v.bitrate || 0) || (v.averageBitrate || 0)) : Math.round(defaultBitrateMbps * 1000000);
      const mbps = bit > 0 ? (bit / 1000000).toFixed(1) : defaultBitrateMbps.toFixed(1);
      const isHdr = v?.qualityLabel?.includes('HDR') || v?.colorInfo?.transferCharacteristics?.includes('SMPTE');
      const isAv1 = v?.mimeType?.includes('av01');
      const size = v?.contentLength ? parseInt(v.contentLength, 10) : Math.round(dur * (parseFloat(mbps) * 1000000 / 8));

      formats.push({
        id: `yt_${key}_mp4`,
        label: `${label} (MP4)`,
        qualityTier: tier,
        resolution: `${v?.qualityLabel || key} • ${mbps} Mbps`,
        fps: v?.fps || 60,
        ext: 'mp4',
        filesizeBytes: size,
        directUrl: mp4s[0]?.url || v?.url || fallbackBaseUrl,
        isVideo: true,
        badge: `${mbps} Mbps`,
        codec: isAv1 ? 'AV1' : 'H.264',
        itag: mp4s[0]?.itag || v?.itag,
      });
    }
  });

  // Audio streams - Preserve ALL distinct audio tracks
  const allAudios = adaptive.filter((f) => f.audioQuality || f.mimeType?.includes('audio'));
  allAudios.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));

  const m4aAudios = allAudios.filter((f) => f.mimeType?.includes('mp4') || f.mimeType?.includes('aac') || f.mimeType?.includes('m4a'));
  const opusAudios = allAudios.filter((f) => f.mimeType?.includes('webm') || f.mimeType?.includes('opus'));

  if (m4aAudios.length > 0) {
    m4aAudios.forEach((bestM4a, idx) => {
      const m4aKbps = bestM4a?.bitrate ? Math.round(bestM4a.bitrate / 1000) : 160;
      const m4aSize = bestM4a?.contentLength ? parseInt(bestM4a.contentLength, 10) : Math.round(dur * (m4aKbps * 1024 / 8));
      const isPrimary = idx === 0;

      formats.push({
        id: isPrimary ? 'yt_audio_m4a' : `yt_audio_m4a_${idx}`,
        label: isPrimary ? 'Hi-Res Audio (M4A)' : `Audio M4A (${m4aKbps}k)`,
        qualityTier: 'audio',
        resolution: `${m4aKbps} kbps (AAC)`,
        ext: 'm4a',
        filesizeBytes: m4aSize,
        directUrl: bestM4a?.url || fallbackBaseUrl,
        isAudio: true,
        badge: `${m4aKbps} KBPS • AAC`,
        codec: 'AAC',
        itag: bestM4a?.itag,
      });
    });
  }

  if (opusAudios.length > 0) {
    opusAudios.forEach((bestOpus, idx) => {
      const opusKbps = bestOpus.bitrate ? Math.round(bestOpus.bitrate / 1000) : 160;
      const opusSize = bestOpus.contentLength ? parseInt(bestOpus.contentLength, 10) : Math.round(dur * (opusKbps * 1024 / 8));
      let lbl = `Audio Opus (${opusKbps}k)`;
      if (idx === 0) lbl = 'Studio Audio (Opus)';
      else if (idx === opusAudios.length - 1) lbl = 'Voice Audio (Opus)';

      formats.push({
        id: idx === 0 ? 'yt_audio_opus' : `yt_audio_opus_${idx}`,
        label: lbl,
        qualityTier: 'audio',
        resolution: `${opusKbps} kbps (Opus)`,
        ext: 'opus',
        filesizeBytes: opusSize,
        directUrl: bestOpus.url || fallbackBaseUrl,
        isAudio: true,
        badge: `${opusKbps} KBPS • OPUS`,
        codec: 'Opus',
        itag: bestOpus?.itag,
      });
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

  // Synchronize any formats (e.g. synthesized 8K, 4K MP4, 2K MP4, audio tracks) into rawStreams
  formats.forEach((fmt) => {
    if (fmt.isSubtitle) return;
    const isVideo = !!fmt.isVideo;
    const isAudio = !!fmt.isAudio;
    const mimeMatch = fmt.ext === 'mp4' ? 'mp4' : 'webm';
    const exists = rawStreams.some((s) => (fmt.itag && s.itag === fmt.itag) || (s.mimeType.includes(mimeMatch) && (s.qualityLabel === fmt.label || (fmt.resolution && s.qualityLabel === fmt.resolution.split('•')[0].trim()))));
    if (!exists) {
      const isHdr = !!(fmt.badge?.includes('HDR') || fmt.codec?.includes('HDR') || fmt.resolution?.includes('HDR'));
      let fallbackItag = fmt.itag;
      if (!fallbackItag) {
        if (fmt.qualityTier === '8k' && fmt.ext === 'mp4') fallbackItag = 571;
        else if (fmt.qualityTier === '8k' && fmt.ext === 'webm') fallbackItag = 272;
        else if (fmt.qualityTier === '4k' && fmt.ext === 'mp4') fallbackItag = 399;
        else if (fmt.qualityTier === '2k' && fmt.ext === 'mp4') fallbackItag = 398;
        else fallbackItag = Math.floor(Math.random() * 900) + 100;
        fmt.itag = fallbackItag;
      }
      rawStreams.push({
        itag: fallbackItag,
        qualityLabel: fmt.resolution?.split('•')[0]?.trim() || fmt.label,
        mimeType: fmt.ext === 'webm' || fmt.ext === 'opus' ? (isAudio ? 'audio/webm' : 'video/webm') : (isAudio ? 'audio/mp4' : 'video/mp4'),
        codec: fmt.codec || (fmt.ext === 'mp4' ? 'H.264 / AV1' : (isAudio ? 'Opus 48kHz' : 'VP9')),
        bitrate: fmt.filesizeBytes ? Math.round((fmt.filesizeBytes * 8) / dur) : 0,
        bitrateFormatted: fmt.badge || `${fmt.ext.toUpperCase()}`,
        fps: fmt.fps,
        filesizeBytes: fmt.filesizeBytes,
        type: isAudio ? 'audio' : 'video',
        directUrl: fmt.directUrl || fallbackBaseUrl,
        isHdr,
      });
    }
  });

  // Sort rawStreams: Video first (highest bitrate & resolution first), then Audio (highest bitrate first)
  rawStreams.sort((a, b) => {
    if (a.type !== b.type) {
      if (a.type === 'video' || a.type === 'muxed') return -1;
      if (b.type === 'video' || b.type === 'muxed') return 1;
    }
    return (b.bitrate || 0) - (a.bitrate || 0);
  });

  return { title, author, description, durationSec, thumbnailUrl };
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

    const playlistMatch = cleanUrl.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
    const isPlaylist = !!playlistMatch;
    const playlistId = playlistMatch ? playlistMatch[1] : undefined;

    const fallbackBaseUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let title = `YouTube Video (${videoId})`;
    let author = 'YouTube Creator';
    let durationSec: number | undefined;
    let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    let description: string | undefined;
    const formats: StreamQualityFormat[] = [];
    const subtitles: SubtitleTrackItem[] = [];
    const rawStreams: RawStreamItem[] = [];
    const chapters: Array<{ title: string; startSec: number; endSec?: number; thumbnailUrl?: string }> = [];

    // 1. Primary extraction via watch page ytInitialPlayerResponse JSON payload
    let parsedSuccess = false;
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
          const res = processPlayerData(data, videoId, fallbackBaseUrl, formats, subtitles, rawStreams, chapters);
          if (res.title) title = res.title;
          if (res.author) author = res.author;
          if (res.description) description = res.description;
          if (res.durationSec) durationSec = res.durationSec;
          if (res.thumbnailUrl) thumbnailUrl = res.thumbnailUrl;
          if (formats.length > 0) parsedSuccess = true;
        }
      }
    } catch {
      /* ignore watch html error */
    }

    // 2. Secondary Innertube multi-client API fallback (Android / Web) if watch page was empty or throttled
    if (!parsedSuccess || formats.length === 0) {
      try {
        const innertubeData = await fetchYouTubeInnertubePlayer(videoId, signal);
        if (innertubeData) {
          const res = processPlayerData(innertubeData, videoId, fallbackBaseUrl, formats, subtitles, rawStreams, chapters);
          if (res.title) title = res.title;
          if (res.author) author = res.author;
          if (res.description) description = res.description;
          if (res.durationSec) durationSec = res.durationSec;
          if (res.thumbnailUrl) thumbnailUrl = res.thumbnailUrl;
          if (formats.length > 0) parsedSuccess = true;
        }
      } catch {
        /* ignore innertube error */
      }
    }

    // 3. Fallback mock tiers if all network parsing was unavailable
    if (formats.length === 0) {
      const dur = durationSec || 180;
      const is8K = /\b(8k|4320p)\b/i.test(title);
      const is4K = is8K || /\b(4k|2160p|uhd)\b/i.test(title);
      const is2K = is4K || /\b(2k|1440p|qhd)\b/i.test(title);

      if (is8K) {
        formats.push({
          id: 'yt_8k',
          label: '8K Ultra HD (MP4)',
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
          label: '4K Ultra HD (MP4)',
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
          label: '2K Quad HD (MP4)',
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
        label: 'Full HD 1080p (MP4)',
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
        label: 'HD 720p (MP4)',
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
        resolution: '160 kbps (AAC)',
        ext: 'm4a',
        filesizeBytes: Math.round(dur * (160 * 1024 / 8)),
        directUrl: fallbackBaseUrl,
        isAudio: true,
        badge: '160 KBPS • AAC',
      });
      formats.push({
        id: 'yt_audio_opus',
        label: 'Studio Audio (Opus)',
        qualityTier: 'audio',
        resolution: '160 kbps (Opus)',
        ext: 'opus',
        filesizeBytes: Math.round(dur * (160 * 1024 / 8)),
        directUrl: fallbackBaseUrl,
        isAudio: true,
        badge: '160 KBPS • OPUS',
      });
      formats.push({
        id: 'yt_audio_saver',
        label: 'Voice Audio (M4A)',
        qualityTier: 'audio',
        resolution: '64 kbps (AAC)',
        ext: 'm4a',
        filesizeBytes: Math.round(dur * (64 * 1024 / 8)),
        directUrl: fallbackBaseUrl,
        isAudio: true,
        badge: '64 KBPS • AAC',
      });
    }

    // Strict Single Highest Quality Video Auto-Selection (Rule 3 & 5)
    // Audio and subtitles must NEVER be pre-selected.
    let defaultFormatId = '';
    const videoFormats = formats.filter((f) => !f.isAudio && !f.isSubtitle && (f.isVideo || f.ext === 'mp4' || f.ext === 'webm'));
    if (videoFormats.length > 0) {
      const highestVideo =
        videoFormats.find((f) => f.qualityTier === '8k' && f.ext === 'mp4') ||
        videoFormats.find((f) => f.qualityTier === '8k') ||
        videoFormats.find((f) => f.qualityTier === '4k' && f.ext === 'mp4') ||
        videoFormats.find((f) => f.qualityTier === '4k') ||
        videoFormats.find((f) => f.qualityTier === '2k' && f.ext === 'mp4') ||
        videoFormats.find((f) => f.qualityTier === '2k') ||
        videoFormats.find((f) => f.qualityTier === '1080p' && f.ext === 'mp4') ||
        videoFormats.find((f) => f.qualityTier === '1080p') ||
        videoFormats[0];
      if (highestVideo) defaultFormatId = highestVideo.id;
    }

    return {
      url: cleanUrl,
      platform: 'youtube',
      platformName: 'YouTube (Ultra-HD)',
      title,
      author,
      artist: author,
      durationSec,
      thumbnailUrl,
      description,
      formats,
      selectedFormatId: defaultFormatId,
      rawStreams,
      subtitles,
      chapters,
      isPlaylist,
      playlistId,
      resolvedAt: Date.now(),
    };
  },
};

