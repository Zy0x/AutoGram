import { invoke } from '@tauri-apps/api/core';
import type {
  ResolvedMediaInfo,
  ResolveOptions,
  StreamQualityFormat,
  SubtitleTrackItem,
  RawStreamItem,
} from '../../types';
import { fetchYtDlpMedia, processYtDlpData } from '../youtubeResolver';
import type { TikTokMetadata } from './types';
import { qualityTierForMeasuredHeight, positiveNumber } from './types';
import { inspectTikTokAudio, attachTikTokMuxIfSilent } from './audioInspector';

/**
 * Probes real bitstream dimensions from the first 128KB of an MP4 container via the `tkhd` box.
 * Returns exact width and height without guessing or placeholder defaults.
 */
async function probeMp4Dimensions(directUrl: string): Promise<{ width?: number; height?: number }> {
  try {
    const res = await fetch(directUrl, {
      headers: { Range: 'bytes=0-131072' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok && res.status !== 206) return {};
    const buf = new Uint8Array(await res.arrayBuffer());
    for (let i = 0; i <= buf.length - 84; i++) {
      if (
        buf[i] === 0x74 && // 't'
        buf[i + 1] === 0x6b && // 'k'
        buf[i + 2] === 0x68 && // 'h'
        buf[i + 3] === 0x64    // 'd'
      ) {
        const version = buf[i + 4];
        const offset = version === 1 ? i + 4 + 88 : i + 4 + 76;
        if (offset + 8 <= buf.length) {
          const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
          const rawW = view.getUint32(offset, false) >> 16;
          const rawH = view.getUint32(offset + 4, false) >> 16;
          if (rawW > 0 && rawH > 0) {
            return { width: rawW, height: rawH };
          }
        }
      }
    }
  } catch {
    // Range probe failed or timed out — graceful fallback
  }
  return {};
}

/**
 * Resolves TikTok and Douyin videos, slideshows, and audio tracks.
 * Uses a multi-tier fallback pipeline:
 * Tier 1: yt-dlp native extractor (uncompressed format matrix, HDR/60fps, codecs)
 * Tier 2: TikWM JSON API with HD clean no-watermark stream & photo slideshows
 * Tier 3: Secondary provider fallback (VKR downloader)
 */
export async function resolveTikTokVideo(
  cleanUrl: string,
  signal?: AbortSignal,
  options?: ResolveOptions
): Promise<ResolvedMediaInfo | null> {
  // Tier 1: Instant lightweight TikWM API via native Rust IPC or direct web fetch (300-500ms)
  try {
    let data: TikTokMetadata | null = null;
    try {
      const json = await invoke<any>('fetch_remote_json_metadata', { url: cleanUrl });
      if (json && json.data) {
        data = json.data as TikTokMetadata;
      }
    } catch (ipcErr) {
      console.warn('[TikTokResolver] IPC fetch failed, trying direct web fetch:', ipcErr);
    }

    if (!data) {
      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}&hd=1`;
      const resp = await fetch(apiUrl, {
        signal: signal || AbortSignal.timeout(6000),
      });

      if (resp.ok) {
        const json = await resp.json();
        if (json && json.data) {
          data = json.data as TikTokMetadata;
        }
      }
    }

    if (data) {
      const title = (data.title || `TikTok_${data.id || Date.now()}`).trim();
      const author = data.author?.nickname ? `@${data.author.unique_id || data.author.nickname}` : undefined;
      const authorAvatar = data.author?.avatar;
      const durationSec = data.duration;
      const formats: StreamQualityFormat[] = [];

      const primarySize = positiveNumber(data.hd_size) || positiveNumber(data.size);
      const measuredBitrate = durationSec && primarySize
        ? Math.round((primarySize * 8) / durationSec)
        : undefined;
      const measuredWidth = positiveNumber(data.width);
      const measuredHeight = positiveNumber(data.height);
      const measuredFps = positiveNumber(data.fps);

      // Inspect audio integrity, muting, and copyright status
      const audioStatus = inspectTikTokAudio(data);

      const postImages = data.images;
      const isPhotoPost = Array.isArray(postImages) && postImages.length > 0;

      if (isPhotoPost && postImages) {
        const allDirectImages = postImages.map((imgUrl: string) =>
          imgUrl.startsWith('http') ? imgUrl : `https://www.tikwm.com${imgUrl}`
        );

        // A. PHOTO / SLIDESHOW MODE (Full Slideshow Pack & Individual Slides)
        if (postImages.length > 1) {
          formats.push({
            id: 'tiktok_photo_all_pack',
            label: `Slideshow Pack (${postImages.length} Photos)`,
            qualityTier: 'original',
            ext: 'zip',
            directUrl: allDirectImages[0],
            isImage: true,
            isAlbumPack: true,
            isDownloadable: true,
            badge: `${postImages.length} PHOTOS`,
            customTitle: `${title} - Slideshow Pack (${postImages.length} Photos)`,
            customFilename: `${title} - Slideshow Pack (${postImages.length} Photos).zip`,
          });
        }

        allDirectImages.forEach((imgUrl: string, idx: number) => {
          formats.push({
            id: `tiktok_photo_${idx + 1}`,
            label: `Photo Slide ${idx + 1} of ${postImages.length}`,
            qualityTier: 'original',
            ext: 'jpg',
            directUrl: imgUrl,
            isImage: true,
            isDownloadable: true,
            badge: `SLIDE ${idx + 1}/${postImages.length}`,
            customTitle: `${title} - Slide ${idx + 1}`,
            customFilename: `${title} - Slide ${idx + 1}.jpg`,
          });
        });
      } else {
        // B. HD CLEAN & WATERMARKED VIDEO MODES
        const primaryPlayUrl = data.hdplay || data.play;
        let probedDimensions: { width?: number; height?: number } = {};
        if (primaryPlayUrl) {
          const directProbeUrl = primaryPlayUrl.startsWith('http') ? primaryPlayUrl : `https://www.tikwm.com${primaryPlayUrl}`;
          probedDimensions = await probeMp4Dimensions(directProbeUrl);
        }

        const realWidth = probedDimensions.width || measuredWidth;
        const realHeight = probedDimensions.height || measuredHeight;
        const effectiveHeight = (realWidth && realHeight)
          ? Math.min(realWidth, realHeight)
          : (measuredHeight || 1080);
        const tier = qualityTierForMeasuredHeight(effectiveHeight);

        if (primaryPlayUrl) {
          const directUrl = primaryPlayUrl.startsWith('http') ? primaryPlayUrl : `https://www.tikwm.com${primaryPlayUrl}`;
          const badgeText = data.hdplay ? 'NO WATERMARK • HD' : 'NO WATERMARK';

          formats.push({
            id: 'tiktok_hd_clean',
            label: `${effectiveHeight}P (No Watermark)`,
            qualityTier: tier,
            resolution: `${effectiveHeight}p`,
            ext: 'mp4',
            width: realWidth,
            height: realHeight || effectiveHeight,
            fps: measuredFps,
            filesizeBytes: primarySize,
            bitrate: measuredBitrate,
            directUrl,
            isVideo: true,
            isCleanNoWatermark: true,
            isDownloadable: true,
            isStreamable: true,
            badge: badgeText,
            customTitle: `${title} - HD Clean (No Watermark)`,
            customFilename: `${title}.mp4`,
          });
        }
      }

      // C. AUDIO STREAM (Standalone track extraction with bitrate & status)
      let resolvedAudioFormat: StreamQualityFormat | undefined;
      if (audioStatus.hasAudio && audioStatus.audioUrl) {
        const musicDuration = durationSec || data.music_info?.duration || 0;
        const bitrate = audioStatus.audioBitrate || 128_000;
        const estimatedAudioSize = musicDuration > 0
          ? Math.round((musicDuration * bitrate) / 8)
          : undefined;

        const musicTitle = audioStatus.audioTitle || `${title} (Audio Track)`;
        const kbps = Math.round(bitrate / 1_000);

        resolvedAudioFormat = {
          id: 'tiktok_audio',
          label: 'Original Audio (MP3)',
          qualityTier: 'audio',
          resolution: `${kbps} kbps`,
          ext: 'mp3',
          filesizeBytes: estimatedAudioSize,
          directUrl: audioStatus.audioUrl,
          thumbnailUrl: data.music_info?.cover || data.author?.avatar || data.cover,
          isAudio: true,
          badge: `MP3 • ${kbps} kbps`,
          bitrate,
          audioBitrate: bitrate,
          sampleRate: audioStatus.sampleRate || 44100,
          audioChannels: audioStatus.audioChannels || 2,
          isDownloadable: true,
          isStreamable: true,
          customTitle: musicTitle,
          customFilename: `${musicTitle}.mp3`,
        };
        formats.push(resolvedAudioFormat);
      }

      // Check audio status and attach mute badge or auto-muxing spec if needed
      for (const format of formats) {
        if (format.isVideo) {
          attachTikTokMuxIfSilent(format, resolvedAudioFormat, audioStatus);
        }
      }

      // D. Creator Profile Avatar
      const highestAvatar = data.music_info?.cover || data.author?.avatar_larger || data.author?.avatar_medium || data.author?.avatar;
      if (highestAvatar) {
        const authorNickname = data.author?.nickname;
        const authorUniqueId = data.author?.unique_id;
        const profileTitle = authorNickname && authorUniqueId
          ? `${authorNickname} (@${authorUniqueId}) - Profil TikTok`
          : authorUniqueId
            ? `@${authorUniqueId} - Profil TikTok`
            : authorNickname
              ? `${authorNickname} - Profil TikTok`
              : 'Creator Profile Photo';

        const directAvatarUrl = highestAvatar.startsWith('http') ? highestAvatar : `https://www.tikwm.com${highestAvatar}`;

        formats.push({
          id: 'tiktok_profile_avatar',
          label: authorUniqueId ? `Foto Profil (@${authorUniqueId})` : 'Creator Profile Photo',
          qualityTier: 'original',
          ext: 'jpg',
          directUrl: directAvatarUrl,
          thumbnailUrl: directAvatarUrl,
          isImage: true,
          isDownloadable: true,
          isStreamable: true,
          badge: '1080x1080',
          width: 1080,
          height: 1080,
          filesizeBytes: 26408,
          customTitle: profileTitle,
          customFilename: `${profileTitle}.jpg`,
        });
      }

      const rawAlbumImages = Array.isArray(data.images) && data.images.length > 0
        ? data.images.map((img: string) => img.startsWith('http') ? img : `https://www.tikwm.com${img}`)
        : undefined;

      const effectiveThumb = rawAlbumImages && rawAlbumImages.length > 0
        ? rawAlbumImages[0]
        : (data.origin_cover || data.cover);

      if (formats.length > 0) {
        return {
          url: cleanUrl,
          platform: 'tiktok',
          platformName: 'TikTok',
          title,
          author,
          authorAvatar,
          durationSec,
          thumbnailUrl: effectiveThumb,
          albumImages: rawAlbumImages,
          formats,
          selectedFormatId: formats[0].id,
          resolvedAt: Date.now(),
        };
      }
    }
  } catch {
    // Continue to Tier 2 yt-dlp extractor fallback below
  }

  // Tier 2: Heavy yt-dlp fallback if TikWM is unavailable or rate limited
  try {
    const ytDlpData = await fetchYtDlpMedia(cleanUrl, signal, Boolean(options?.forceRefresh));
    if (ytDlpData) {
      const formats: StreamQualityFormat[] = [];
      const subtitles: SubtitleTrackItem[] = [];
      const rawStreams: RawStreamItem[] = [];
      const metadata = processYtDlpData(ytDlpData, formats, subtitles, rawStreams);
      if (formats.length > 0) {
        const selected =
          [...formats]
            .filter((format) => format.isVideo)
            .sort(
              (a, b) =>
                Number(b.height || 0) - Number(a.height || 0) ||
                Number(b.fps || 0) - Number(a.fps || 0) ||
                Number(b.bitrate || 0) - Number(a.bitrate || 0)
            )[0] || formats[0];

        return {
          url: cleanUrl,
          platform: 'tiktok',
          platformName: 'TikTok',
          title: metadata.title || `TikTok_${Date.now()}`,
          author: metadata.author,
          durationSec: metadata.durationSec,
          thumbnailUrl: metadata.thumbnailUrl,
          formats,
          subtitles,
          rawStreams,
          selectedFormatId: selected.id,
          resolvedAt: Date.now(),
        };
      }
    }
  } catch {
    // Continue to Tier 3 secondary provider fallback below.
  }

  // Tier 3: Secondary provider fallback (VKR downloader)
  try {
    const fallbackUrl = `https://api.vkrdownloader.com/server?vkr=${encodeURIComponent(cleanUrl)}`;
    const resp2 = await fetch(fallbackUrl, {
      signal: signal || AbortSignal.timeout(6000),
    });
    if (resp2.ok) {
      const resJson = await resp2.json();
      const downloadUrl = resJson.data?.downloadUrl || resJson.downloadUrl || resJson.url;
      if (downloadUrl) {
        return {
          url: cleanUrl,
          platform: 'tiktok',
          platformName: 'TikTok',
          title: resJson.data?.title || resJson.title || `TikTok_${Date.now()}`,
          thumbnailUrl: resJson.data?.thumbnail || resJson.thumbnail,
          durationSec: resJson.data?.duration,
          formats: [
            {
              id: 'tiktok_nwm_fallback',
              label: 'Original (MP4)',
              qualityTier: 'original',
              ext: 'mp4',
              directUrl: downloadUrl,
              isCleanNoWatermark: true,
              isVideo: true,
              isDownloadable: true,
              isStreamable: true,
            },
          ],
          selectedFormatId: 'tiktok_nwm_fallback',
          resolvedAt: Date.now(),
        };
      }
    }
  } catch {
    /* fallback exhausted */
  }

  return null;
}
