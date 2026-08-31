import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../../tauri/platform';
import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat, RawStreamItem, SubtitleTrackItem } from '../types';

// ---------------------------------------------------------------------------
// yt-dlp JSON result cache keyed by video ID.
// Avoids spawning the yt-dlp subprocess again when the user re-inspects the
// same YouTube URL within a 30-minute window.
// Note: The registry-level cache also covers this, but this inner cache
// specifically prevents duplicate concurrent spawns for the same video.
// ---------------------------------------------------------------------------
const YTDLP_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const ytdlpCache = new Map<string, { data: any; expiresAt: number }>();


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

function parseCipherUrl(cipherStr?: string): string | undefined {
  if (!cipherStr) return undefined;
  try {
    const params = new URLSearchParams(cipherStr);
    const url = params.get('url');
    if (!url) return undefined;
    const sig = params.get('s') || params.get('sig') || params.get('signature');
    const sp = params.get('sp') || 'sig';
    if (sig) {
      const glue = url.includes('?') ? '&' : '?';
      return `${url}${glue}${sp}=${encodeURIComponent(sig)}`;
    }
    return url;
  } catch {
    return undefined;
  }
}

async function fetchYouTubeInnertubePlayer(videoId: string, signal?: AbortSignal): Promise<any | null> {
  // Public player API key used by YouTube's own clients (not a user secret).
  const apiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCil_w_Y9_11qcW8';
  const clients = [
    {
      clientName: 'ANDROID',
      clientVersion: '21.26.364',
      osName: 'Android',
      osVersion: '11',
      androidSdkVersion: 30,
      userAgent: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip',
    },
    {
      clientName: 'ANDROID',
      clientVersion: '19.29.35',
      osName: 'Android',
      osVersion: '14',
      androidSdkVersion: 34,
      userAgent: 'com.google.android.youtube/19.29.35 (Linux; U; Android 14) gzip',
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
        playbackContext: {
          contentPlaybackContext: {
            html5Preference: 'HTML5_PREF_WANTS',
          },
        },
        contentCheckOk: true,
        racyCheckOk: true,
      });

      const endpoint = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`;
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': client.userAgent || 'Mozilla/5.0',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': client.clientVersion,
        Origin: 'https://www.youtube.com',
      };

      // Tauri CSP intentionally blocks arbitrary browser POSTs. Use the
      // native HTTP bridge there; web builds still use fetch below.
      if (detectTauriRuntime()) {
        const text = await invoke<string>('fetch_native_http', {
          url: endpoint,
          method: 'POST',
          headers,
          body: payload,
        });
        const data = JSON.parse(text);
        if (data?.videoDetails || data?.streamingData) return data;
      } else {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: payload,
          signal: signal || AbortSignal.timeout(4500),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.videoDetails || data?.streamingData) return data;
        }
      }
    } catch {
      /* continue to next client fallback */
    }
  }
  return null;
}

async function fetchYouTubeYtDlp(url: string): Promise<any | null> {
  if (!detectTauriRuntime()) return null;
  let ytdlpEnabled = true;
  let autoUpdate = true;
  let checkIntervalHours = 6;
  let customPath: string | undefined;
  let cookiesMode: string | undefined;
  let cookiesBrowser: string | undefined;
  let cookiesPath: string | undefined;
  let poToken: string | undefined;
  let extractorArgs: string | undefined;
  let customArgs: string | undefined;
  let ffmpegPath: string | undefined;

  try {
    const raw = localStorage.getItem('autogram_drive_transfer_settings');
    if (raw) {
      const settings = JSON.parse(raw) as any;
      ytdlpEnabled = settings.ytdlpEnabled !== false;
      autoUpdate = settings.ytdlpAutoUpdate !== false;
      checkIntervalHours = Math.max(1, Math.min(168, Number(settings.ytdlpCheckIntervalHours) || 6));
      if (settings.ytdlpCustomPath?.trim()) customPath = settings.ytdlpCustomPath.trim();
      if (settings.ytdlpCookiesMode && settings.ytdlpCookiesMode !== 'none') cookiesMode = settings.ytdlpCookiesMode;
      if (settings.ytdlpCookiesBrowser?.trim()) cookiesBrowser = settings.ytdlpCookiesBrowser.trim();
      if (settings.ytdlpPoToken?.trim()) poToken = settings.ytdlpPoToken.trim();
      if (settings.ytdlpExtractorArgs?.trim() && settings.ytdlpExtractorArgs.trim() !== 'youtube:player_client=android,web') {
        extractorArgs = settings.ytdlpExtractorArgs.trim();
      }
      if (settings.ytdlpCustomArgs?.trim()) customArgs = settings.ytdlpCustomArgs.trim();
      if (settings.ffmpegCustomPath?.trim()) ffmpegPath = settings.ffmpegCustomPath.trim();
    }
  } catch {
    // Keep the safe defaults when settings are unavailable.
  }
  if (!ytdlpEnabled) return null;

  // Cache key combines URL + settings fingerprint so cookie/arg changes invalidate
  const cacheKey = `${url}|${cookiesMode ?? ''}|${cookiesBrowser ?? ''}|${poToken ?? ''}|${extractorArgs ?? ''}`;
  const cached = ytdlpCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  try {
    const text = await invoke<string>('ytdlp_resolve', {
      url,
      autoUpdate,
      checkIntervalHours,
      customPath,
      cookiesMode,
      cookiesBrowser,
      cookiesPath,
      poToken,
      extractorArgs,
      customArgs,
      ffmpegPath,
    });
    const data = JSON.parse(text);
    const result = data && Array.isArray(data.formats) ? data : null;
    if (result) {
      ytdlpCache.set(cacheKey, { data: result, expiresAt: Date.now() + YTDLP_CACHE_TTL_MS });
    }
    return result;
  } catch (err) {
    console.warn('[youtubeResolver] yt-dlp resolution fallback:', err);
    return null;
  }
}

function qualityTierForHeight(height?: number): StreamQualityFormat['qualityTier'] {
  if (!height) return 'original';
  if (height >= 4320) return '8k';
  if (height >= 2160) return '4k';
  if (height >= 1440) return '2k';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  if (height >= 240) return '240p';
  if (height >= 144) return '144p';
  return 'original';
}

function defaultBitrateForHeight(height?: number, isAudio?: boolean): number {
  if (isAudio) return 128_000;
  if (!height) return 2_000_000;
  if (height >= 4320) return 50_000_000;
  if (height >= 2160) return 25_000_000;
  if (height >= 1440) return 16_000_000;
  if (height >= 1080) return 8_000_000;
  if (height >= 720) return 4_000_000;
  if (height >= 480) return 2_000_000;
  if (height >= 360) return 1_000_000;
  if (height >= 240) return 500_000;
  return 250_000;
}

function stableFormatNumber(value: unknown, index: number): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const raw = String(value || index);
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return 100000 + Math.abs(hash % 899999);
}

export function processYtDlpData(
  data: any,
  formats: StreamQualityFormat[],
  subtitles: SubtitleTrackItem[],
  rawStreams: RawStreamItem[],
): { title?: string; author?: string; description?: string; durationSec?: number; thumbnailUrl?: string } {
  const durationSec = typeof data?.duration === 'number' ? data.duration : undefined;
  const title = data?.title || data?.fulltitle;
  const author = data?.uploader || data?.channel;
  const description = data?.description;
  const thumbnailUrl = data?.thumbnail;
  const sourceFormats = Array.isArray(data?.formats) ? data.formats : [];

  const tierBestMap = new Map<string, { fmt: StreamQualityFormat; bitrate: number }>();

  sourceFormats.forEach((f: any, index: number) => {
    const directUrl = typeof f?.url === 'string' && /^https?:\/\//i.test(f.url) ? f.url : undefined;
    if (!directUrl) return;
    const vcodec = String(f.vcodec || 'none');
    const acodec = String(f.acodec || 'none');
    const isVideo = vcodec !== 'none';
    const isAudio = !isVideo && acodec !== 'none';
    if (!isVideo && !isAudio) return;
    const protocol = String(f.protocol || (/[.]m3u8(?:\?|$)/i.test(directUrl) ? 'm3u8' : 'https'));
    const isManifest = /(?:m3u8|mpd)(?:\?|$)/i.test(protocol) || /[.]m3u8(?:\?|$)/i.test(directUrl);
    const height = typeof f.height === 'number' ? f.height : undefined;
    const rawBitrate = Number(f.tbr || f.vbr || f.abr || 0) * 1000;
    const audioBitrate = Number(f.abr || 0) * 1000;
    const effectiveBitrate = (isAudio ? audioBitrate : rawBitrate) || defaultBitrateForHeight(height, isAudio);
    const bitrateText = effectiveBitrate >= 1_000_000
      ? `${(effectiveBitrate / 1_000_000).toFixed(1)} Mbps`
      : `${Math.round(effectiveBitrate / 1000)} kbps`;
    const formatId = String(f.format_id || stableFormatNumber(f.format_id, index));
    const itag = stableFormatNumber(formatId, index);
    const ext = String(f.ext || (isAudio ? 'm4a' : 'mp4')).toLowerCase();

    // Streamable determination:
    // - All audio formats with browser support
    // - Muxed video (with audio) <= 1080p in mp4/webm
    // - Manifests (m3u8)
    const isMuxed = isVideo && acodec !== 'none';
    const streamable = isManifest
      || isAudio
      || ['mp4', 'webm'].includes(ext);
    const downloadable = true;

    const label = isAudio
      ? `${ext.toUpperCase()} ${Math.round((effectiveBitrate || 0) / 1000)} kbps`
      : `${f.format_note || (height ? `${height}p` : 'Video')} (${ext.toUpperCase()})`;
    const qualityTier = isAudio ? 'audio' : qualityTierForHeight(height);
    const codec = String(vcodec !== 'none' ? vcodec : acodec);
    const rawSize = Number(f.filesize || f.filesize_approx || 0) || 0;
    const estimatedBytes = (!rawSize && durationSec && effectiveBitrate > 0)
      ? Math.round((effectiveBitrate * durationSec) / 8)
      : 0;
    const size = rawSize || (estimatedBytes > 0 ? estimatedBytes : undefined);

    const stream: RawStreamItem = {
      itag,
      qualityLabel: isAudio ? 'Audio Stream' : (f.format_note || `${height || 'Video'}p`),
      mimeType: isAudio ? `audio/${ext}` : `video/${ext}`,
      codec,
      bitrate: effectiveBitrate,
      bitrateFormatted: bitrateText,
      fps: typeof f.fps === 'number' ? f.fps : undefined,
      filesizeBytes: size,
      type: isMuxed ? 'muxed' : (isAudio ? 'audio' : 'video'),
      directUrl,
      protocol,
      container: ext,
      width: f.width,
      height,
      sampleRate: f.asr ? Number(f.asr) : undefined,
      audioChannels: f.audio_channels,
      isDownloadable: downloadable,
      isStreamable: streamable,
      downloadOnly: downloadable && !streamable,
    };
    rawStreams.push(stream);

    const fmtItem: StreamQualityFormat = {
      id: `yt_ytdlp_${formatId}`,
      label,
      qualityTier,
      resolution: isAudio ? `${Math.round((effectiveBitrate || 0) / 1000)} kbps` : `${height || 'unknown'}p • ${bitrateText}`,
      fps: stream.fps,
      ext,
      filesizeBytes: size,
      directUrl,
      isDownloadable: downloadable,
      isStreamable: streamable,
      downloadOnly: downloadable && !streamable,
      isVideo,
      isAudio,
      badge: isAudio ? bitrateText : `${height || 'Video'}p • ${bitrateText}`,
      codec,
      protocol,
      container: ext,
      itag,
    };

    // Collect all valid direct single-file binary streams into formats list (manifests stay in rawStreams only)
    if (!isManifest) {
      formats.push(fmtItem);

      const tierKey = isAudio ? `audio_${ext}` : `${qualityTier}_${ext}`;
      const existing = tierBestMap.get(tierKey);
      if (!existing || effectiveBitrate > existing.bitrate) {
        tierBestMap.set(tierKey, { fmt: fmtItem, bitrate: effectiveBitrate });
      }
    }
  });

  // Deduplicate formats by unique ID
  const seenIds = new Set<string>();
  const uniqueFormats: StreamQualityFormat[] = [];
  formats.forEach((f) => {
    if (!seenIds.has(f.id)) {
      seenIds.add(f.id);
      uniqueFormats.push(f);
    }
  });
  formats.length = 0;
  formats.push(...uniqueFormats);

  const subtitleMap = data?.subtitles && typeof data.subtitles === 'object' ? data.subtitles : {};
  const autoCaptionMap = data?.automatic_captions && typeof data.automatic_captions === 'object' ? data.automatic_captions : {};
  const tracks = [...Object.values(subtitleMap).flat(), ...Object.values(autoCaptionMap).flat()] as any[];
  tracks.forEach((track: any, index) => {
    const directUrl = track?.url;
    if (!directUrl) return;
    const languageCode = String(track?.language || track?.name || `track-${index}`);
    subtitles.push({
      id: `yt_sub_${languageCode}_${index}`,
      languageCode,
      languageName: languageCode.toUpperCase(),
      isAutoGenerated: false,
      directUrl,
    });
  });

  return { title, author, description, durationSec, thumbnailUrl };
}

function processPlayerData(
  data: any,
  videoId: string,
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

  // Only include formats with valid, direct playable URLs (never attach a 360p URL to higher resolution tiers)
  const allFormats = [...adaptive, ...regular]
    .map((f) => {
      let directUrl = typeof f?.url === 'string' && f.url.startsWith('http') ? f.url : undefined;
      if (!directUrl && (f?.signatureCipher || f?.cipher)) {
        directUrl = parseCipherUrl(f.signatureCipher || f.cipher);
      }
      return {
        ...f,
        url: directUrl,
      };
    })
    .filter((f) => typeof f?.url === 'string' && f.url.startsWith('http'));

  const dur = durationSec || 180;

  const tiers: Array<{ key: string; label: string; tier: '8k' | '4k' | '2k' | '1080p' | '720p' | '480p' | '360p' | '240p' | '144p'; height: number; defaultBitrateMbps: number }> = [
    { key: '4320p', label: '8K Ultra HD', tier: '8k', height: 4320, defaultBitrateMbps: 50.0 },
    { key: '2160p', label: '4K Ultra HD', tier: '4k', height: 2160, defaultBitrateMbps: 25.0 },
    { key: '1440p', label: '2K Quad HD', tier: '2k', height: 1440, defaultBitrateMbps: 12.0 },
    { key: '1080p', label: 'Full HD 1080p', tier: '1080p', height: 1080, defaultBitrateMbps: 4.5 },
    { key: '720p', label: 'HD 720p', tier: '720p', height: 720, defaultBitrateMbps: 2.5 },
    { key: '480p', label: 'SD 480p', tier: '480p', height: 480, defaultBitrateMbps: 1.2 },
    { key: '360p', label: 'Compact 360p', tier: '360p', height: 360, defaultBitrateMbps: 0.6 },
    { key: '240p', label: '240p', tier: '240p', height: 240, defaultBitrateMbps: 0.3 },
    { key: '144p', label: '144p', tier: '144p', height: 144, defaultBitrateMbps: 0.15 },
  ];

  tiers.forEach(({ key, label, tier, height, defaultBitrateMbps }) => {
    const tierMatches = allFormats.filter((f) => {
      const isAud = !f.qualityLabel && (f.mimeType?.includes('audio') || !!f.audioQuality);
      if (isAud) return false;
      const ql = (f.qualityLabel || '').toLowerCase();
      return ql.startsWith(key) || ql.includes(key) || (f.height && Math.abs(f.height - height) <= 25);
    });

    const webms = tierMatches.filter((f) => f.mimeType?.includes('webm') || f.mimeType?.includes('vp9'));
    webms.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));

    const mp4s = tierMatches.filter((f) => f.mimeType?.includes('mp4') || f.mimeType?.includes('avc1') || f.mimeType?.includes('av01'));
    mp4s.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));

    // 1. WebM stream - strictly when concrete WebM stream exists on server
    if (webms.length > 0) {
      const v = webms[0];
      const bit = (v.bitrate || 0) || (v.averageBitrate || 0) || Math.round(defaultBitrateMbps * 1000000);
      const mbps = bit > 0 ? (bit / 1000000).toFixed(1) : defaultBitrateMbps.toFixed(1);
      const isHdr = v.qualityLabel?.includes('HDR') || v.mimeType?.includes('vp9.2');
      const size = v.contentLength ? parseInt(v.contentLength, 10) : Math.round(dur * (parseFloat(mbps) * 1000000 / 8));

      formats.push({
        id: `yt_${key}_webm`,
        label: `${label} (WebM)`,
        qualityTier: tier,
        resolution: `${v.qualityLabel || key} • ${mbps} Mbps`,
        fps: v.fps || (isHdr ? 60 : 30),
        ext: 'webm',
        filesizeBytes: size,
        directUrl: v.url,
        isDownloadable: true,
        isStreamable: true,
        isVideo: true,
        badge: `${mbps} Mbps`,
        codec: isHdr ? 'VP9 HDR' : 'VP9',
        itag: v.itag,
      });
    }

    // 2. MP4 stream - strictly when concrete MP4 stream exists on server
    if (mp4s.length > 0) {
      const v = mp4s[0];
      const bit = (v.bitrate || 0) || (v.averageBitrate || 0) || Math.round(defaultBitrateMbps * 1000000);
      const mbps = bit > 0 ? (bit / 1000000).toFixed(1) : defaultBitrateMbps.toFixed(1);
      const isAv1 = v.mimeType?.includes('av01');
      const size = v.contentLength ? parseInt(v.contentLength, 10) : Math.round(dur * (parseFloat(mbps) * 1000000 / 8));

      formats.push({
        id: `yt_${key}_mp4`,
        label: `${label} (MP4)`,
        qualityTier: tier,
        resolution: `${v.qualityLabel || key} • ${mbps} Mbps`,
        fps: v.fps || 60,
        ext: 'mp4',
        filesizeBytes: size,
        directUrl: v.url,
        isDownloadable: true,
        isStreamable: true,
        isVideo: true,
        badge: `${mbps} Mbps`,
        codec: isAv1 ? 'AV1' : 'H.264',
        itag: v.itag,
      });
    }
  });

  // Audio streams - Preserve every concrete audio track with deduplication
  const allAudios = allFormats.filter(
    (f) => !f.qualityLabel && (f.audioQuality || f.mimeType?.includes('audio'))
  );
  allAudios.sort((a, b) => ((b.bitrate || 0) || (b.averageBitrate || 0)) - ((a.bitrate || 0) || (a.averageBitrate || 0)));

  const m4aAudios = allAudios.filter((f) => f.mimeType?.includes('mp4') || f.mimeType?.includes('aac') || f.mimeType?.includes('m4a'));
  const opusAudios = allAudios.filter((f) => f.mimeType?.includes('webm') || f.mimeType?.includes('opus'));

  const seenM4aBitrates = new Set<number>();
  m4aAudios.forEach((bestM4a) => {
    const m4aKbps = bestM4a?.bitrate ? Math.round(bestM4a.bitrate / 1000) : 128;
    if (seenM4aBitrates.has(m4aKbps)) return;
    seenM4aBitrates.add(m4aKbps);
    const m4aSize = bestM4a?.contentLength ? parseInt(bestM4a.contentLength, 10) : Math.round(dur * (m4aKbps * 1024 / 8));
    const isPrimary = formats.filter((f) => f.isAudio && f.ext === 'm4a').length === 0;

    formats.push({
      id: isPrimary ? 'yt_audio_m4a' : `yt_audio_m4a_${m4aKbps}k`,
      label: isPrimary ? 'Hi-Res Audio (M4A)' : `Audio M4A (${m4aKbps}k)`,
      qualityTier: 'audio',
      resolution: `${m4aKbps} kbps (AAC)`,
      ext: 'm4a',
      filesizeBytes: m4aSize,
      directUrl: bestM4a.url,
      isDownloadable: true,
      isStreamable: true,
      isAudio: true,
      badge: `${m4aKbps} KBPS • AAC`,
      codec: 'AAC',
      itag: bestM4a.itag,
    });
  });

  const seenOpusBitrates = new Set<number>();
  opusAudios.forEach((bestOpus) => {
    const opusKbps = bestOpus?.bitrate ? Math.round(bestOpus.bitrate / 1000) : 160;
    if (seenOpusBitrates.has(opusKbps)) return;
    seenOpusBitrates.add(opusKbps);
    const opusSize = bestOpus?.contentLength ? parseInt(bestOpus.contentLength, 10) : Math.round(dur * (opusKbps * 1024 / 8));
    const count = formats.filter((f) => f.isAudio && f.ext === 'opus').length;
    let lbl = `Audio Opus (${opusKbps}k)`;
    if (count === 0) lbl = 'Studio Audio (Opus)';
    else if (opusKbps <= 60) lbl = `Voice Audio (Opus ${opusKbps}k)`;

    formats.push({
      id: count === 0 ? 'yt_audio_opus' : `yt_audio_opus_${opusKbps}k`,
      label: lbl,
      qualityTier: 'audio',
      resolution: `${opusKbps} kbps (Opus)`,
      ext: 'opus',
      filesizeBytes: opusSize,
      directUrl: bestOpus.url,
      isDownloadable: true,
      isStreamable: true,
      isAudio: true,
      badge: `${opusKbps} KBPS • OPUS`,
      codec: 'Opus',
      itag: bestOpus.itag,
    });
  });

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

  // Raw streams: 100% concrete streams directly from YouTube server response
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
      directUrl: f.url,
      isHdr,
      protocol: f.type === 'FORMAT_STREAM_TYPE_OTF' ? 'otf' : 'https',
      container: mime.split('/')[1]?.split(';')[0],
      width: f.width,
      height: f.height,
      sampleRate: f.audioSampleRate ? Number(f.audioSampleRate) : undefined,
      audioChannels: f.audioChannels,
      isDownloadable: true,
      isStreamable: true,
    });
  });

  // Guarantee that every rawStream has a matching format in `formats` for seamless double-click playback and selection
  rawStreams.forEach((s) => {
    const exists = formats.some((fmt) => fmt.itag === s.itag);
    if (!exists) {
      const isAud = s.type === 'audio';
      const qualityLabel = s.qualityLabel || (isAud ? 'Audio Stream' : 'Video Stream');
      const isMp4 = s.mimeType.includes('mp4');
      const ext = isMp4 ? (isAud ? 'm4a' : 'mp4') : (isAud ? 'opus' : 'webm');
      formats.push({
        id: `yt_itag_${s.itag}`,
        label: qualityLabel,
        qualityTier: isAud ? 'audio' : (qualityLabel.includes('4320') ? '8k' : qualityLabel.includes('2160') ? '4k' : qualityLabel.includes('1440') ? '2k' : qualityLabel.includes('1080') ? '1080p' : qualityLabel.includes('720') ? '720p' : qualityLabel.includes('480') ? '480p' : qualityLabel.includes('360') ? '360p' : qualityLabel.includes('240') ? '240p' : qualityLabel.includes('144') ? '144p' : 'original'),
        resolution: `${qualityLabel} • ${s.bitrateFormatted}`,
        fps: s.fps,
        ext,
        filesizeBytes: s.filesizeBytes,
        directUrl: s.directUrl,
        isDownloadable: s.isDownloadable,
        isStreamable: s.isStreamable,
        isVideo: !isAud,
        isAudio: isAud,
        badge: s.bitrateFormatted,
        codec: s.codec,
        itag: s.itag,
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

    let title = `YouTube Video (${videoId})`;
    let author = 'YouTube Creator';
    let durationSec: number | undefined;
    let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    let description: string | undefined;
    const formats: StreamQualityFormat[] = [];
    const subtitles: SubtitleTrackItem[] = [];
    const rawStreams: RawStreamItem[] = [];
    const chapters: Array<{ title: string; startSec: number; endSec?: number; thumbnailUrl?: string }> = [];

    // 1. Primary extraction via the updateable yt-dlp plugin. It can expose
    // formats that YouTube's browser clients return as SABR-only metadata.
    let parsedSuccess = false;
    if (detectTauriRuntime()) {
      try {
        const ytDlpData = await fetchYouTubeYtDlp(cleanUrl);
        if (ytDlpData) {
          const res = processYtDlpData(ytDlpData, formats, subtitles, rawStreams);
          if (res.title) title = res.title;
          if (res.author) author = res.author;
          if (res.description) description = res.description;
          if (res.durationSec) durationSec = res.durationSec;
          if (res.thumbnailUrl) thumbnailUrl = res.thumbnailUrl;
          parsedSuccess = formats.length > 0 || rawStreams.length > 0;
        }
      } catch (err) {
        console.warn('[youtubeResolver] yt-dlp execution error:', err);
      }
    }

    // 2 & 3. Parallel fallback: fetch watch-page HTML and Innertube simultaneously.
    // This halves fallback latency compared to the old serial approach.
    // Only runs when yt-dlp path produced nothing.
    if (!parsedSuccess) {
      try {
        // Launch both requests at the same time.
        const [htmlResult, innertubeResult] = await Promise.allSettled([
          fetchYouTubeWatchHtml(cleanUrl, signal),
          fetchYouTubeInnertubePlayer(videoId, signal),
        ]);

        // --- Process watch-page HTML response ---
        let htmlFormats: StreamQualityFormat[] = [];
        let htmlSubtitles: SubtitleTrackItem[] = [];
        let htmlRawStreams: RawStreamItem[] = [];
        let htmlMeta: { title?: string; author?: string; description?: string; durationSec?: number; thumbnailUrl?: string } = {};

        if (htmlResult.status === 'fulfilled' && htmlResult.value) {
          const html = htmlResult.value;
          const titleMatch =
            html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
            html.match(/<meta\s+name="title"\s+content="([^"]+)"/i) ||
            html.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch?.[1]) htmlMeta.title = titleMatch[1].replace(/\s*-\s*YouTube$/i, '').trim();

          const authorMatch =
            html.match(/<meta\s+name="author"\s+content="([^"]+)"/i) ||
            html.match(/<link\s+itemprop="name"\s+content="([^"]+)"/i);
          if (authorMatch?.[1]) htmlMeta.author = authorMatch[1].trim();

          const descMatch =
            html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
            html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
          if (descMatch?.[1]) htmlMeta.description = descMatch[1].trim();

          const playerJsonMatch =
            html.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:var\s|window\[|\n|<\/script>)/s) ||
            html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);

          if (playerJsonMatch?.[1]) {
            try {
              const data = JSON.parse(playerJsonMatch[1]);
              const res = processPlayerData(data, videoId, htmlFormats, htmlSubtitles, htmlRawStreams, chapters);
              if (res.title) htmlMeta.title = res.title;
              if (res.author) htmlMeta.author = res.author;
              if (res.description) htmlMeta.description = res.description;
              if (res.durationSec) htmlMeta.durationSec = res.durationSec;
              if (res.thumbnailUrl) htmlMeta.thumbnailUrl = res.thumbnailUrl;
            } catch { /* ignore JSON parse error */ }
          }
        }

        // --- Process Innertube response ---
        let innerFormats: StreamQualityFormat[] = [];
        let innerSubtitles: SubtitleTrackItem[] = [];
        let innerRawStreams: RawStreamItem[] = [];
        let innerMeta: { title?: string; author?: string; description?: string; durationSec?: number; thumbnailUrl?: string } = {};

        if (innertubeResult.status === 'fulfilled' && innertubeResult.value) {
          const res = processPlayerData(innertubeResult.value, videoId, innerFormats, innerSubtitles, innerRawStreams, chapters);
          if (res.title) innerMeta.title = res.title;
          if (res.author) innerMeta.author = res.author;
          if (res.description) innerMeta.description = res.description;
          if (res.durationSec) innerMeta.durationSec = res.durationSec;
          if (res.thumbnailUrl) innerMeta.thumbnailUrl = res.thumbnailUrl;
        }

        // --- Merge: prefer whichever source has downloadable video formats ---
        const htmlHasVideo = htmlFormats.some((f) => f.isVideo && f.directUrl);
        const innerHasVideo = innerFormats.some((f) => f.isVideo && f.directUrl);

        // Pick the better source (prioritize html if it has video, otherwise innertube)
        const bestFormats = htmlHasVideo ? htmlFormats : innerHasVideo ? innerFormats : htmlFormats.length > 0 ? htmlFormats : innerFormats;
        const bestMeta = htmlHasVideo ? htmlMeta : innerHasVideo ? innerMeta : (Object.keys(htmlMeta).length > 0 ? htmlMeta : innerMeta);
        const bestSubtitles = htmlHasVideo ? htmlSubtitles : innerSubtitles;
        const bestRawStreams = htmlHasVideo ? htmlRawStreams : innerRawStreams;

        // Apply best results
        if (bestMeta.title) title = bestMeta.title;
        if (bestMeta.author) author = bestMeta.author;
        if (bestMeta.description) description = bestMeta.description;
        if (bestMeta.durationSec) durationSec = bestMeta.durationSec;
        if (bestMeta.thumbnailUrl) thumbnailUrl = bestMeta.thumbnailUrl;
        formats.push(...bestFormats);
        subtitles.push(...bestSubtitles);
        rawStreams.push(...bestRawStreams);

        if (formats.some((f) => f.isVideo && f.directUrl)) parsedSuccess = true;

        // If html had no video but innertube did, also merge innertube formats
        // to avoid losing audio tracks
        if (!htmlHasVideo && innerHasVideo && htmlFormats.length > 0) {
          // Already used innerFormats above — nothing extra needed
        } else if (htmlHasVideo && innerHasVideo) {
          // Both have video: no need to merge, html already selected as best
        }
      } catch {
        /* ignore parallel fallback error */
      }
    }

    // Legacy guard: if still nothing and signal not aborted, this is an empty result

    // Never synthesize formats from the title or a watch-page URL. A YouTube
    // watch URL is not a media stream and would make a fake quality card look
    // downloadable. If the player endpoint is blocked, return no formats and
    // let the UI explain that a fresh inspection is required.

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
      platformName: 'YouTube',
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
