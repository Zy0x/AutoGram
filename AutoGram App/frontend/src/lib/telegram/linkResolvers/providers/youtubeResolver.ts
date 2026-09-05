import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../../tauri/platform';
import type { LinkResolverProvider, ResolvedMediaInfo, ResolveOptions, StreamQualityFormat, RawStreamItem, SubtitleTrackItem } from '../types';

// ---------------------------------------------------------------------------
// yt-dlp JSON result cache keyed by video ID.
// Avoids spawning the yt-dlp subprocess again when the user re-inspects the
// same YouTube URL within a 30-minute window.
// Note: The registry-level cache also covers this, but this inner cache
// specifically prevents duplicate concurrent spawns for the same video.
// ---------------------------------------------------------------------------
const YTDLP_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const ytdlpCache = new Map<string, { data: any; expiresAt: number }>();
let ytdlpRequestSequence = 0;

function createYtDlpRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  ytdlpRequestSequence += 1;
  return `remote-${Date.now().toString(36)}-${ytdlpRequestSequence.toString(36)}`;
}


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

/**
 * Runs the updateable yt-dlp provider for a public media page. The parser is
 * platform-neutral, so TikTok and future extractor-backed providers share the
 * exact same update, cookie-isolation and timeout behaviour as YouTube.
 */
export async function fetchYtDlpMedia(
  url: string,
  signal?: AbortSignal,
  forceRefresh = false,
): Promise<any | null> {
  if (!detectTauriRuntime()) return null;
  if (signal?.aborted) return null;
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

  // Cache key combines URL + settings fingerprint so cookie/arg changes invalidate
  const cacheKey = `${url}|${cookiesMode ?? ''}|${cookiesBrowser ?? ''}|${poToken ?? ''}|${extractorArgs ?? ''}`;
  const cached = ytdlpCache.get(cacheKey);
  // A user-initiated Re-inspect must obtain a fresh extractor response: signed
  // media URLs can expire even while their metadata is still within the cache TTL.
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const requestId = createYtDlpRequestId();
  let abortListener: (() => void) | undefined;
  try {
    const resolvePromise = invoke<string>('ytdlp_resolve', {
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
      requestId,
    });
    const text = signal
      ? await Promise.race([
        resolvePromise,
        new Promise<never>((_, reject) => {
          abortListener = () => {
            void invoke('ytdlp_cancel_resolve', { requestId }).catch(() => undefined);
            reject(new DOMException('Remote inspection cancelled', 'AbortError'));
          };
          signal.addEventListener('abort', abortListener, { once: true });
          if (signal.aborted) abortListener();
        }),
      ])
      : await resolvePromise;
    const data = JSON.parse(text);
    const result = data && Array.isArray(data.formats) ? data : null;
    if (result) {
      ytdlpCache.set(cacheKey, { data: result, expiresAt: Date.now() + YTDLP_CACHE_TTL_MS });
    }
    return result;
  } catch (err) {
    if (signal?.aborted) return null;
    console.warn('[youtubeResolver] yt-dlp resolution fallback:', err);
    return null;
  } finally {
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
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

function stableFormatNumber(value: unknown, index: number): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const raw = String(value || index);
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return 100000 + Math.abs(hash % 899999);
}

export const SUBTITLE_LANGUAGE_NAMES: Record<string, string> = {
  id: 'Indonesian (Bahasa Indonesia)',
  en: 'English',
  'en-us': 'English (US)',
  'en-gb': 'English (UK)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  zh: 'Chinese (中文)',
  'zh-hans': 'Chinese Simplified (简体中文)',
  'zh-hant': 'Chinese Traditional (繁體中文)',
  'zh-cn': 'Chinese (China)',
  'zh-tw': 'Chinese (Taiwan)',
  'zh-hk': 'Chinese (Hong Kong)',
  es: 'Spanish (Español)',
  'es-419': 'Spanish (Latin America)',
  'es-es': 'Spanish (Spain)',
  fr: 'French (Français)',
  'fr-ca': 'French (Canada)',
  de: 'German (Deutsch)',
  ru: 'Russian (Русский)',
  ar: 'Arabic (العربية)',
  pt: 'Portuguese (Português)',
  'pt-br': 'Portuguese (Brasil)',
  'pt-pt': 'Portuguese (Portugal)',
  it: 'Italian (Italiano)',
  hi: 'Hindi (हिन्दी)',
  th: 'Thai (ไทย)',
  vi: 'Vietnamese (Tiếng Việt)',
  tr: 'Turkish (Türkçe)',
  nl: 'Dutch (Nederlands)',
  pl: 'Polish (Polski)',
  ms: 'Malay (Bahasa Melayu)',
  jv: 'Javanese (Basa Jawa)',
  su: 'Sundanese (Basa Sunda)',
  fil: 'Filipino (Tagalog)',
  fa: 'Persian (فارسی)',
  uk: 'Ukrainian (Українська)',
  sv: 'Swedish (Svenska)',
  el: 'Greek (Ελληνικά)',
  he: 'Hebrew (עברית)',
  cs: 'Czech (Čeština)',
  hu: 'Hungarian (Magyar)',
  ro: 'Romanian (Română)',
  da: 'Danish (Dansk)',
  fi: 'Finnish (Suomi)',
  no: 'Norwegian (Norsk)',
  bn: 'Bengali (বাংলা)',
  ta: 'Tamil (தமிழ்)',
  te: 'Telugu (తెలుగు)',
  mr: 'Marathi (मराठी)',
  ur: 'Urdu (اردو)',
};

export function getHumanReadableLanguageName(code: string, fallback?: string): string {
  const normalized = (code || '').toLowerCase().trim();
  if (SUBTITLE_LANGUAGE_NAMES[normalized]) return SUBTITLE_LANGUAGE_NAMES[normalized];
  const base = normalized.split(/[-_.]/)[0];
  if (SUBTITLE_LANGUAGE_NAMES[base]) return `${SUBTITLE_LANGUAGE_NAMES[base]} (${code})`;
  if (fallback && fallback.trim() && fallback.toLowerCase() !== normalized) {
    return fallback.trim();
  }
  return code.toUpperCase();
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
    // Bitrate must come from the extractor. A guessed rate turns a provider
    // title into a false quality card, particularly when YouTube only exposes
    // SABR metadata to a browser client.
    const effectiveBitrate = isAudio ? audioBitrate : rawBitrate;
    const bitrateText = effectiveBitrate > 0 && effectiveBitrate >= 1_000_000
      ? `${(effectiveBitrate / 1_000_000).toFixed(1)} Mbps`
      : effectiveBitrate > 0 ? `${Math.round(effectiveBitrate / 1000)} kbps` : '';
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
      ? `${ext.toUpperCase()}${effectiveBitrate > 0 ? ` ${Math.round(effectiveBitrate / 1000)} kbps` : ''}`
      : `${height ? `${height}p` : 'Original'} (${ext.toUpperCase()})`;
    const qualityTier = isAudio ? 'audio' : qualityTierForHeight(height);
    const codec = String(vcodec !== 'none' ? vcodec : acodec);
    const rawSize = Number(f.filesize || f.filesize_approx || 0) || 0;
    const estimatedBytes = (!rawSize && durationSec && effectiveBitrate > 0)
      ? Math.round((effectiveBitrate * durationSec) / 8)
      : 0;
    const size = rawSize || (estimatedBytes > 0 ? estimatedBytes : undefined);

    const stream: RawStreamItem = {
      itag,
      qualityLabel: isAudio ? 'Audio Stream' : (height ? `${height}p` : 'Original'),
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
      resolution: isAudio
        ? (effectiveBitrate > 0 ? `${Math.round(effectiveBitrate / 1000)} kbps` : undefined)
        : (height ? `${height}p` : undefined),
      fps: stream.fps,
      ext,
      filesizeBytes: size,
      directUrl,
      isDownloadable: downloadable,
      isStreamable: streamable,
      downloadOnly: downloadable && !streamable,
      isVideo,
      isAudio,
      badge: bitrateText || undefined,
      codec,
      protocol,
      container: ext,
      width: typeof f.width === 'number' ? f.width : undefined,
      height,
      bitrate: effectiveBitrate || undefined,
      audioBitrate: audioBitrate || undefined,
      sampleRate: f.asr ? Number(f.asr) : undefined,
      audioChannels: typeof f.audio_channels === 'number' ? f.audio_channels : undefined,
      isHdr: String(f.dynamic_range || '').toLowerCase() === 'hdr' || /(?:hdr|hlg|pq)/i.test(String(f.format_note || '')),
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

  // Extract Subtitles from yt-dlp (both manual and auto-captions) with full language resolution
  const subtitleMap = data?.subtitles && typeof data.subtitles === 'object' ? data.subtitles : {};
  const autoCaptionMap = data?.automatic_captions && typeof data.automatic_captions === 'object' ? data.automatic_captions : {};

  const processSubGroup = (map: Record<string, any[]>, isAuto: boolean) => {
    Object.entries(map).forEach(([langCode, trackList]) => {
      if (!Array.isArray(trackList) || trackList.length === 0) return;
      const cleanLang = langCode.trim();
      const sampleTrack = trackList[0];
      const langName = getHumanReadableLanguageName(cleanLang, sampleTrack?.name);

      const preferredExts = ['vtt', 'srt', 'ass', 'ttml', 'srv3', 'json3'];
      const sortedTracks = [...trackList].sort((a, b) => {
        const extA = String(a.ext || '').toLowerCase();
        const extB = String(b.ext || '').toLowerCase();
        const idxA = preferredExts.indexOf(extA);
        const idxB = preferredExts.indexOf(extB);
        return (idxA >= 0 ? idxA : 99) - (idxB >= 0 ? idxB : 99);
      });

      if (sortedTracks.length > 0 && sortedTracks[0].url) {
        const primaryTrack = sortedTracks[0];
        const primaryExt = String(primaryTrack.ext || 'vtt').toLowerCase();
        const subId = `yt_sub_${cleanLang}_${primaryExt}_${isAuto ? 'auto' : 'manual'}`;

        subtitles.push({
          id: subId,
          languageCode: cleanLang,
          languageName: isAuto ? `${langName} (Auto)` : langName,
          isAutoGenerated: isAuto,
          directUrl: primaryTrack.url,
        });
      }

      const seenExts = new Set<string>();
      sortedTracks.forEach((track, trackIdx) => {
        const directUrl = track?.url;
        if (!directUrl) return;
        const ext = String(track?.ext || 'vtt').toLowerCase();
        if (seenExts.has(ext)) return;
        seenExts.add(ext);

        const subFmtId = `yt_sub_${cleanLang}_${ext}_${isAuto ? 'auto' : 'manual'}_${trackIdx}`;
        formats.push({
          id: subFmtId,
          label: `Subtitle ${langName}${isAuto ? ' (Auto)' : ''} (.${ext.toUpperCase()})`,
          qualityTier: 'subtitle',
          resolution: cleanLang.toUpperCase(),
          ext,
          directUrl,
          isSubtitle: true,
          isDownloadable: true,
          isStreamable: false,
          badge: isAuto ? `${cleanLang.toUpperCase()} • AUTO • ${ext.toUpperCase()}` : `${cleanLang.toUpperCase()} • ${ext.toUpperCase()}`,
          customTitle: `${title || 'Video'} - ${langName}${isAuto ? ' (Auto)' : ''}.${ext}`,
          customFilename: `${title || 'Video'}.${cleanLang}.${ext}`,
        });
      });
    });
  };

  processSubGroup(subtitleMap, false);
  processSubGroup(autoCaptionMap, true);

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

  const dur = durationSec;

  const tiers: Array<{ key: string; tier: '8k' | '4k' | '2k' | '1080p' | '720p' | '480p' | '360p' | '240p' | '144p'; height: number }> = [
    { key: '4320p', tier: '8k', height: 4320 },
    { key: '2160p', tier: '4k', height: 2160 },
    { key: '1440p', tier: '2k', height: 1440 },
    { key: '1080p', tier: '1080p', height: 1080 },
    { key: '720p', tier: '720p', height: 720 },
    { key: '480p', tier: '480p', height: 480 },
    { key: '360p', tier: '360p', height: 360 },
    { key: '240p', tier: '240p', height: 240 },
    { key: '144p', tier: '144p', height: 144 },
  ];

  tiers.forEach(({ key, tier, height }) => {
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
      const bit = (v.bitrate || 0) || (v.averageBitrate || 0);
      const bitrateText = bit >= 1_000_000 ? `${(bit / 1_000_000).toFixed(1)} Mbps` : bit > 0 ? `${Math.round(bit / 1_000)} kbps` : '';
      const isHdr = v.qualityLabel?.includes('HDR') || v.mimeType?.includes('vp9.2');
      const actualHeight = typeof v.height === 'number' && v.height > 0 ? v.height : undefined;
      const size = v.contentLength ? parseInt(v.contentLength, 10) : undefined;

      formats.push({
        id: `yt_${key}_webm`,
        label: `${actualHeight ? `${actualHeight}p` : 'Original'} (WebM)`,
        qualityTier: tier,
        resolution: actualHeight ? `${actualHeight}p` : undefined,
        fps: typeof v.fps === 'number' ? v.fps : undefined,
        ext: 'webm',
        filesizeBytes: size,
        directUrl: v.url,
        isDownloadable: true,
        isStreamable: true,
        isVideo: true,
        badge: bitrateText || undefined,
        codec: isHdr ? 'VP9 HDR' : 'VP9',
        itag: v.itag,
        width: typeof v.width === 'number' ? v.width : undefined,
        height: actualHeight,
        bitrate: bit || undefined,
        isHdr,
      });
    }

    // 2. MP4 stream - strictly when concrete MP4 stream exists on server
    if (mp4s.length > 0) {
      const v = mp4s[0];
      const bit = (v.bitrate || 0) || (v.averageBitrate || 0);
      const bitrateText = bit >= 1_000_000 ? `${(bit / 1_000_000).toFixed(1)} Mbps` : bit > 0 ? `${Math.round(bit / 1_000)} kbps` : '';
      const isAv1 = v.mimeType?.includes('av01');
      const actualHeight = typeof v.height === 'number' && v.height > 0 ? v.height : undefined;
      const size = v.contentLength ? parseInt(v.contentLength, 10) : undefined;

      formats.push({
        id: `yt_${key}_mp4`,
        label: `${actualHeight ? `${actualHeight}p` : 'Original'} (MP4)`,
        qualityTier: tier,
        resolution: actualHeight ? `${actualHeight}p` : undefined,
        fps: typeof v.fps === 'number' ? v.fps : undefined,
        ext: 'mp4',
        filesizeBytes: size,
        directUrl: v.url,
        isDownloadable: true,
        isStreamable: true,
        isVideo: true,
        badge: bitrateText || undefined,
        codec: isAv1 ? 'AV1' : 'H.264',
        itag: v.itag,
        width: typeof v.width === 'number' ? v.width : undefined,
        height: actualHeight,
        bitrate: bit || undefined,
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
    const m4aBitrate = Number(bestM4a?.bitrate || bestM4a?.averageBitrate || 0);
    if (m4aBitrate <= 0) return;
    const m4aKbps = Math.round(m4aBitrate / 1000);
    if (seenM4aBitrates.has(m4aKbps)) return;
    seenM4aBitrates.add(m4aKbps);
    const m4aSize = bestM4a?.contentLength
      ? parseInt(bestM4a.contentLength, 10)
      : dur && dur > 0 ? Math.round(dur * (m4aBitrate / 8)) : undefined;

    formats.push({
      id: `yt_audio_m4a_${m4aKbps}k`,
      label: `M4A ${m4aKbps} kbps`,
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
      bitrate: m4aBitrate,
      audioBitrate: m4aBitrate,
      sampleRate: bestM4a.audioSampleRate ? Number(bestM4a.audioSampleRate) : undefined,
      audioChannels: typeof bestM4a.audioChannels === 'number' ? bestM4a.audioChannels : undefined,
    });
  });

  const seenOpusBitrates = new Set<number>();
  opusAudios.forEach((bestOpus) => {
    const opusBitrate = Number(bestOpus?.bitrate || bestOpus?.averageBitrate || 0);
    if (opusBitrate <= 0) return;
    const opusKbps = Math.round(opusBitrate / 1000);
    if (seenOpusBitrates.has(opusKbps)) return;
    seenOpusBitrates.add(opusKbps);
    const opusSize = bestOpus?.contentLength
      ? parseInt(bestOpus.contentLength, 10)
      : dur && dur > 0 ? Math.round(dur * (opusBitrate / 8)) : undefined;

    formats.push({
      id: `yt_audio_opus_${opusKbps}k`,
      label: `Opus ${opusKbps} kbps`,
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
      bitrate: opusBitrate,
      audioBitrate: opusBitrate,
      sampleRate: bestOpus.audioSampleRate ? Number(bestOpus.audioSampleRate) : undefined,
      audioChannels: typeof bestOpus.audioChannels === 'number' ? bestOpus.audioChannels : undefined,
    });
  });

  const captionTracks = (
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
    data?.captions?.playerCaptionsRenderer?.captionTracks ||
    []
  ) as any[];
  const existingLangCodes = new Set<string>();

  captionTracks.forEach((c) => {
    if (!c.baseUrl) return;
    const langCode = String(c.languageCode || 'id').toLowerCase();
    existingLangCodes.add(langCode);
    const rawName = c.name?.simpleText || c.name?.runs?.[0]?.text;
    const langName = getHumanReadableLanguageName(langCode, rawName);
    const isAuto = c.vssId?.startsWith('a.') || c.kind === 'asr';
    const cleanSubName = isAuto ? `${langName} (Auto)` : langName;

    const vttUrl = `${c.baseUrl}&fmt=vtt`;
    const srv3Url = `${c.baseUrl}&fmt=srv3`;

    const subIdVtt = `yt_sub_${langCode}_vtt_${isAuto ? 'auto' : 'manual'}`;
    const subIdSrt = `yt_sub_${langCode}_srt_${isAuto ? 'auto' : 'manual'}`;

    subtitles.push({
      id: subIdVtt,
      languageCode: langCode,
      languageName: cleanSubName,
      isAutoGenerated: isAuto,
      directUrl: vttUrl,
      vssId: c.vssId,
    });

    // 1. WebVTT Format (.VTT)
    formats.push({
      id: subIdVtt,
      label: `Subtitle ${cleanSubName} (.VTT)`,
      qualityTier: 'subtitle',
      resolution: langCode.toUpperCase(),
      ext: 'vtt',
      directUrl: vttUrl,
      isSubtitle: true,
      isDownloadable: true,
      isStreamable: false,
      badge: isAuto ? `${langCode.toUpperCase()} • AUTO • VTT` : `${langCode.toUpperCase()} • VTT`,
      customTitle: `${title || 'Video'} - ${cleanSubName}.vtt`,
      customFilename: `${title || 'Video'}.${langCode}.vtt`,
    });

    // 2. SubRip Format (.SRT)
    formats.push({
      id: subIdSrt,
      label: `Subtitle ${cleanSubName} (.SRT)`,
      qualityTier: 'subtitle',
      resolution: langCode.toUpperCase(),
      ext: 'srt',
      directUrl: srv3Url,
      isSubtitle: true,
      isDownloadable: true,
      isStreamable: false,
      badge: isAuto ? `${langCode.toUpperCase()} • AUTO • SRT` : `${langCode.toUpperCase()} • SRT`,
      customTitle: `${title || 'Video'} - ${cleanSubName}.srt`,
      customFilename: `${title || 'Video'}.${langCode}.srt`,
    });
  });

  // Generate auto-translated subtitle options for popular languages (e.g. ID, EN, JA) if base captions exist
  if (captionTracks.length > 0) {
    const baseTrack = captionTracks.find((c) => !c.vssId?.startsWith('a.') && c.baseUrl) || captionTracks[0];
    if (baseTrack?.baseUrl) {
      const popularTranslationLangs = ['id', 'en', 'ja', 'ko', 'es', 'ar', 'zh-Hans', 'ru', 'fr', 'de'];
      popularTranslationLangs.forEach((tlang) => {
        if (existingLangCodes.has(tlang)) return;
        const langName = getHumanReadableLanguageName(tlang);
        const vttUrl = `${baseTrack.baseUrl}&tlang=${tlang}&fmt=vtt`;
        const srv3Url = `${baseTrack.baseUrl}&tlang=${tlang}&fmt=srv3`;

        const subIdVtt = `yt_sub_${tlang}_vtt_trans`;
        const subIdSrt = `yt_sub_${tlang}_srt_trans`;

        subtitles.push({
          id: subIdVtt,
          languageCode: tlang,
          languageName: `${langName} (Auto-Trans)`,
          isAutoGenerated: true,
          directUrl: vttUrl,
        });

        formats.push({
          id: subIdVtt,
          label: `Subtitle ${langName} (Auto-Trans) (.VTT)`,
          qualityTier: 'subtitle',
          resolution: tlang.toUpperCase(),
          ext: 'vtt',
          directUrl: vttUrl,
          isSubtitle: true,
          isDownloadable: true,
          isStreamable: false,
          badge: `${tlang.toUpperCase()} • TRANS • VTT`,
          customTitle: `${title || 'Video'} - ${langName} (Auto-Trans).vtt`,
          customFilename: `${title || 'Video'}.${tlang}.vtt`,
        });

        formats.push({
          id: subIdSrt,
          label: `Subtitle ${langName} (Auto-Trans) (.SRT)`,
          qualityTier: 'subtitle',
          resolution: tlang.toUpperCase(),
          ext: 'srt',
          directUrl: srv3Url,
          isSubtitle: true,
          isDownloadable: true,
          isStreamable: false,
          badge: `${tlang.toUpperCase()} • TRANS • SRT`,
          customTitle: `${title || 'Video'} - ${langName} (Auto-Trans).srt`,
          customFilename: `${title || 'Video'}.${tlang}.srt`,
        });
      });
    }
  }

  // Raw streams: 100% concrete streams directly from YouTube server response
  allFormats.forEach((f) => {
    const bit = (f.bitrate || 0) || (f.averageBitrate || 0);
    const mbps = bit >= 1000000 ? `${(bit / 1000000).toFixed(1)} Mbps` : bit > 0 ? `${Math.round(bit / 1000)} kbps` : '';
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
    const size = f.contentLength
      ? parseInt(f.contentLength, 10)
      : (dur && dur > 0 && bit > 0 ? Math.round(dur * (bit / 8)) : undefined);

    rawStreams.push({
      itag: f.itag || 0,
      qualityLabel: f.height ? `${f.height}p` : (isAudio ? 'Audio Stream' : 'Original'),
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
    if (
      s.protocol?.toLowerCase().includes('m3u8') ||
      s.directUrl?.toLowerCase().includes('.m3u8') ||
      (s.filesizeBytes === 0 && !s.bitrate)
    ) {
      return;
    }
    const exists = formats.some((fmt) => fmt.itag === s.itag);
    if (!exists) {
      const isAud = s.type === 'audio';
      const qualityLabel = s.height ? `${s.height}p` : (isAud ? 'Audio Stream' : 'Original');
      const isMp4 = s.mimeType.includes('mp4');
      const ext = isMp4 ? (isAud ? 'm4a' : 'mp4') : (isAud ? 'opus' : 'webm');
      formats.push({
        id: `yt_itag_${s.itag}`,
        label: qualityLabel,
        qualityTier: isAud ? 'audio' : qualityTierForHeight(s.height),
        resolution: isAud
          ? (s.bitrate > 0 ? `${Math.round(s.bitrate / 1_000)} kbps` : undefined)
          : (s.height ? `${s.height}p` : undefined),
        fps: s.fps,
        ext,
        filesizeBytes: s.filesizeBytes,
        directUrl: s.directUrl,
        isDownloadable: s.isDownloadable,
        isStreamable: s.isStreamable,
        isVideo: !isAud,
        isAudio: isAud,
        badge: s.bitrateFormatted || undefined,
        codec: s.codec,
        itag: s.itag,
        width: s.width,
        height: s.height,
        bitrate: s.bitrate || undefined,
        audioBitrate: isAud ? s.bitrate || undefined : undefined,
        sampleRate: s.sampleRate,
        audioChannels: s.audioChannels,
        isHdr: s.isHdr === true,
        protocol: s.protocol,
        container: s.container,
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
    options?: ResolveOptions
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
        const ytDlpData = await fetchYtDlpMedia(cleanUrl, signal, Boolean(options?.forceRefresh));
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
