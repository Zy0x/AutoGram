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
  // Tier 1: Prefer updateable yt-dlp extractor first
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
    // Continue to Tier 2 public lightweight metadata service below.
  }

  // Tier 2: TikWM API via native Rust IPC or direct web fetch
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
        signal: signal || AbortSignal.timeout(8000),
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
            label: `All Photos (${postImages.length})`,
            qualityTier: 'original',
            ext: 'jpg',
            directUrl: allDirectImages[0],
            allAlbumUrls: allDirectImages,
            isAlbumPack: true,
            isImage: true,
            isCleanNoWatermark: true,
            badge: `FULL ALBUM (${postImages.length})`,
          });
        }

        postImages.forEach((imgUrl: string, idx: number) => {
          const fullImgUrl = imgUrl.startsWith('http') ? imgUrl : `https://www.tikwm.com${imgUrl}`;
          formats.push({
            id: `tiktok_photo_${idx + 1}`,
            label: postImages.length === 1 ? 'Original Photo' : `Photo ${idx + 1} of ${postImages.length}`,
            qualityTier: 'original',
            ext: 'jpg',
            directUrl: fullImgUrl,
            isImage: true,
            isCleanNoWatermark: true,
            badge: postImages.length === 1 ? 'PHOTO' : `PHOTO ${idx + 1}`,
          });
        });
      } else {
        // B. VIDEO MODE
        if (data.hdplay) {
          const hdFormat: StreamQualityFormat = {
            id: 'tiktok_hd_nwm',
            label: measuredHeight ? `${measuredHeight}p (MP4)` : 'Original (MP4)',
            qualityTier: qualityTierForMeasuredHeight(measuredHeight),
            resolution: measuredHeight ? `${measuredHeight}p` : undefined,
            fps: measuredFps,
            ext: 'mp4',
            filesizeBytes: data.hd_size || data.size,
            directUrl: data.hdplay.startsWith('http') ? data.hdplay : `https://www.tikwm.com${data.hdplay}`,
            isCleanNoWatermark: true,
            isVideo: true,
            badge: measuredBitrate ? `${Math.round(measuredBitrate / 1_000)} kbps` : undefined,
            width: measuredWidth,
            height: measuredHeight,
            bitrate: measuredBitrate,
            isDownloadable: true,
            isStreamable: true,
          };
          formats.push(hdFormat);
        }

        const hasDistinctStandardStream =
          data.play &&
          data.play !== data.hdplay &&
          (!data.hdplay || (data.size && data.hd_size && data.size < data.hd_size * 0.92));

        if (hasDistinctStandardStream) {
          formats.push({
            id: 'tiktok_standard_nwm',
            label: 'Original (MP4)',
            qualityTier: 'original',
            ext: 'mp4',
            filesizeBytes: data.size,
            directUrl: data.play!.startsWith('http') ? data.play! : `https://www.tikwm.com${data.play}`,
            isCleanNoWatermark: true,
            isVideo: true,
            isDownloadable: true,
            isStreamable: true,
          });
        } else if (!data.hdplay && data.play) {
          formats.push({
            id: 'tiktok_standard_nwm',
            label: measuredHeight ? `${measuredHeight}p (MP4)` : 'Original (MP4)',
            qualityTier: qualityTierForMeasuredHeight(measuredHeight),
            resolution: measuredHeight ? `${measuredHeight}p` : undefined,
            fps: measuredFps,
            ext: 'mp4',
            filesizeBytes: data.size,
            directUrl: data.play.startsWith('http') ? data.play : `https://www.tikwm.com${data.play}`,
            isCleanNoWatermark: true,
            isVideo: true,
            badge: measuredBitrate ? `${Math.round(measuredBitrate / 1_000)} kbps` : undefined,
            width: measuredWidth,
            height: measuredHeight,
            bitrate: measuredBitrate,
            isDownloadable: true,
            isStreamable: true,
          });
        }
      }

      // C. AUDIO STREAM (Standalone track extraction with bitrate & status)
      let resolvedAudioFormat: StreamQualityFormat | undefined;
      if (audioStatus.hasAudio && audioStatus.audioUrl) {
        const estimatedAudioSize = durationSec && audioStatus.audioBitrate
          ? Math.round(durationSec * (audioStatus.audioBitrate / 8))
          : undefined;

        const musicTitle = audioStatus.audioTitle || `${title} (Audio Track)`;

        resolvedAudioFormat = {
          id: 'tiktok_audio',
          label: audioStatus.audioBitrate ? `MP3 ${Math.round(audioStatus.audioBitrate / 1_000)} kbps` : 'Original Audio (MP3)',
          qualityTier: 'audio',
          resolution: audioStatus.audioBitrate ? `${Math.round(audioStatus.audioBitrate / 1_000)} kbps` : undefined,
          ext: 'mp3',
          filesizeBytes: estimatedAudioSize,
          directUrl: audioStatus.audioUrl,
          isAudio: true,
          badge: audioStatus.audioBitrate ? `${Math.round(audioStatus.audioBitrate / 1_000)} kbps` : undefined,
          bitrate: audioStatus.audioBitrate,
          audioBitrate: audioStatus.audioBitrate,
          sampleRate: audioStatus.sampleRate,
          audioChannels: audioStatus.audioChannels,
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
      const highestAvatar = data.author?.avatar_larger || data.author?.avatar_medium || data.author?.avatar;
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

        formats.push({
          id: 'tiktok_profile_avatar',
          label: 'Creator Profile Photo',
          qualityTier: 'original',
          ext: 'jpg',
          directUrl: highestAvatar.startsWith('http') ? highestAvatar : `https://www.tikwm.com${highestAvatar}`,
          isImage: true,
          isDownloadable: true,
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
    // Continue to Tier 3 fallback below
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
