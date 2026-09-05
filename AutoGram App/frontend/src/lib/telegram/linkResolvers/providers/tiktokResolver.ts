import { invoke } from '@tauri-apps/api/core';
import type { LinkResolverProvider, ResolvedMediaInfo, ResolveOptions, StreamQualityFormat, QualityTier, RawStreamItem, SubtitleTrackItem } from '../types';
import { fetchYtDlpMedia, processYtDlpData } from './youtubeResolver';

function qualityTierForMeasuredHeight(height?: number): QualityTier {
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

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * TikTok resolver using the shared yt-dlp provider first, then constrained
 * public metadata fallbacks that never invent media quality.
 */
export const tiktokResolver: LinkResolverProvider = {
  name: 'TikTokResolver',
  platform: 'tiktok',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return u.includes('tiktok.com') || u.includes('douyin.com');
  },

  async resolve(url: string, signal?: AbortSignal, options?: ResolveOptions): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();

    // 0. Profile URL handler (e.g. https://www.tiktok.com/@tokyo.prompt or https://www.tiktok.com/@izuru.01)
    const profileMatch = cleanUrl.match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)(?:\/)?(?:[?#].*)?$/);
    if (profileMatch && !cleanUrl.includes('/video/') && !cleanUrl.includes('/photo/') && !cleanUrl.includes('/story/')) {
      const uniqueId = profileMatch[1];
      try {
        let nickname: string | undefined;
        let avatarLarger: string | undefined;
        let avatarMedium: string | undefined;
        let signature: string | undefined;

        // 1. Try native Rust IPC for rich profile metadata (zero CORS, custom mobile UA)
        try {
          const jsonMeta = await invoke<any>('fetch_remote_json_metadata', { url: cleanUrl });
          if (jsonMeta?.data?.user) {
            const u = jsonMeta.data.user;
            nickname = u.nickname || nickname;
            avatarLarger = u.avatarLarger || avatarLarger;
            avatarMedium = u.avatarMedium || avatarMedium;
            signature = u.signature || signature;
          }
          if (!avatarLarger && jsonMeta?.html) {
            const html = jsonMeta.html;
            const pos = html.indexOf('"avatarLarger":"');
            if (pos !== -1) {
              const start = pos + 16;
              const end = html.indexOf('"', start);
              if (end !== -1) {
                avatarLarger = html.slice(start, end).replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\/g, '');
              }
            }
            const nickPos = html.indexOf('"nickname":"');
            if (nickPos !== -1) {
              const start = nickPos + 12;
              const end = html.indexOf('"', start);
              if (end !== -1) {
                nickname = html.slice(start, end).replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\/g, '');
              }
            }
          }
        } catch (ipcErr) {
          console.warn('[TikTokResolver] IPC fetch failed:', ipcErr);
        }

        // 2. Try local dev server proxy (always available in dev mode)
        if (!avatarLarger) {
          try {
            const proxyResp = await fetch(`/__autogram_remote_meta?url=${encodeURIComponent(cleanUrl)}`, {
              signal: signal || AbortSignal.timeout(6000),
            });
            if (proxyResp.ok) {
              const pdata = await proxyResp.json();
              if (pdata?.data?.user) {
                nickname = pdata.data.user.nickname || nickname;
                avatarLarger = pdata.data.user.avatarLarger || avatarLarger;
                avatarMedium = pdata.data.user.avatarMedium || avatarMedium;
                signature = pdata.data.user.signature || signature;
              }
            }
          } catch {
            /* dev proxy fallback */
          }
        }

        // 3. Try native text fetch if not resolved
        if (!avatarLarger) {
          try {
            const html = await invoke<string>('fetch_remote_text_content', {
              url: `https://www.tiktok.com/@${uniqueId}`,
              userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            });
            if (html) {
              const pos = html.indexOf('"avatarLarger":"');
              if (pos !== -1) {
                const start = pos + 16;
                const end = html.indexOf('"', start);
                if (end !== -1) {
                  avatarLarger = html.slice(start, end).replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\/g, '');
                }
              }
              const nickPos = html.indexOf('"nickname":"');
              if (nickPos !== -1) {
                const start = nickPos + 12;
                const end = html.indexOf('"', start);
                if (end !== -1) {
                  nickname = html.slice(start, end).replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\/g, '');
                }
              }
            }
          } catch {
            /* text IPC fallback */
          }
        }

        // 4. Fallback to direct web fetch
        if (!avatarLarger) {
          try {
            const pageResp = await fetch(`https://www.tiktok.com/@${uniqueId}`, {
              signal: signal || AbortSignal.timeout(6000),
            });
            if (pageResp.ok) {
              const html = await pageResp.text();
              const avatarMatch = html.match(/"avatarLarger":"(https:[^"]+)"/i);
              if (avatarMatch) {
                avatarLarger = avatarMatch[1].replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\/g, '');
              }
            }
          } catch {
            /* web fetch fallback */
          }
        }

        // 4. Fallback to oEmbed if nickname not resolved yet
        if (!nickname) {
          try {
            const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`;
            const oresp = await fetch(oembedUrl, { signal: signal || AbortSignal.timeout(5000) });
            if (oresp.ok) {
              const odata = await oresp.json();
              nickname = odata.author_name;
            }
          } catch {
            /* oembed fallback */
          }
        }

        const authorName = nickname || `@${uniqueId}`;
        const title = `${authorName} (@${uniqueId}) - Profil TikTok`;
        const formats: StreamQualityFormat[] = [];

        // Unified Creator Profile Photo with embedded metadata caption
        const effectiveAvatar = avatarLarger || avatarMedium;
        if (effectiveAvatar) {
          formats.push({
            id: 'tiktok_profile_avatar',
            label: 'Creator Profile Photo',
            qualityTier: 'original',
            ext: 'jpg',
            directUrl: effectiveAvatar,
            isImage: true,
            isCleanNoWatermark: true,
            isDownloadable: true,
          });
        } else {
          // Fallback only if avatar image could not be retrieved
          formats.push({
            id: 'tiktok_profile_link',
            label: `Profile Information (@${uniqueId})`,
            qualityTier: 'original',
            ext: 'txt',
            directUrl: cleanUrl,
            badge: 'PROFILE',
            isDownloadable: false,
            isStreamable: false,
            verification: {
              status: 'wrapper',
              sourceUrl: cleanUrl,
              reason: 'Profile page is not a direct transferable file',
            },
          });
        }

        return {
          url: cleanUrl,
          platform: 'tiktok',
          platformName: 'TikTok (Creator Profile)',
          title,
          author: `@${uniqueId}`,
          authorAvatar: effectiveAvatar,
          thumbnailUrl: effectiveAvatar,
          formats,
          selectedFormatId: formats[0].id,
          resolvedAt: Date.now(),
        };
      } catch {
        /* fallback */
      }
    }

    // Prefer the updateable extractor first. It reports TikTok's actual
    // formats, codecs, dimensions, bitrates and subtitle/audio tracks rather
    // than deriving 1080p or 320 kbps from a page title or URL shape.
    try {
      const ytDlpData = await fetchYtDlpMedia(cleanUrl, signal, Boolean(options?.forceRefresh));
      if (ytDlpData) {
        const formats: StreamQualityFormat[] = [];
        const subtitles: SubtitleTrackItem[] = [];
        const rawStreams: RawStreamItem[] = [];
        const metadata = processYtDlpData(ytDlpData, formats, subtitles, rawStreams);
        if (formats.length > 0) {
          const selected = [...formats]
            .filter((format) => format.isVideo)
            .sort((a, b) =>
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
      // Continue to the public lightweight metadata service below. It may
      // yield a direct original URL, but never fabricated stream qualities.
    }

    // Public metadata fallback for a direct original URL when yt-dlp is not
    // available. Its cards intentionally remain Original unless the service
    // publishes concrete media metadata.
    try {
      let data: any = null;
      try {
        const json = await invoke<any>('fetch_remote_json_metadata', { url: cleanUrl });
        if (json && json.data) {
          data = json.data;
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
            data = json.data;
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

          // A public metadata service may give us only a URL. Keep such a
          // result as Original; resolution/FPS are never inferred from title,
          // file size or a provider's “HD” label.
          const isPhotoPost = Array.isArray(data.images) && data.images.length > 0;

          if (isPhotoPost) {
            const allDirectImages = data.images.map((imgUrl: string) =>
              imgUrl.startsWith('http') ? imgUrl : `https://www.tikwm.com${imgUrl}`
            );

            // A. PHOTO / SLIDESHOW MODE (Full Slideshow Pack & Individual Slides)
            if (data.images.length > 1) {
              formats.push({
                id: 'tiktok_photo_all_pack',
                label: `All Photos (${data.images.length})`,
                qualityTier: 'original',
                ext: 'jpg',
                directUrl: allDirectImages[0],
                allAlbumUrls: allDirectImages,
                isAlbumPack: true,
                isImage: true,
                isCleanNoWatermark: true,
                badge: `FULL ALBUM (${data.images.length})`,
              });
            }

            data.images.forEach((imgUrl: string, idx: number) => {
              const fullImgUrl = imgUrl.startsWith('http') ? imgUrl : `https://www.tikwm.com${imgUrl}`;
              formats.push({
                id: `tiktok_photo_${idx + 1}`,
                label: data.images.length === 1 
                  ? 'Original Photo'
                  : `Photo ${idx + 1} of ${data.images.length}`,
                qualityTier: 'original',
                ext: 'jpg',
                directUrl: fullImgUrl,
                isImage: true,
                isCleanNoWatermark: true,
                badge: data.images.length === 1 ? 'PHOTO' : `PHOTO ${idx + 1}`,
              });
            });
          } else {
            // B. VIDEO MODE
            if (data.hdplay) {
              formats.push({
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
              });
            }

            // A distinct public URL is still a separate transferable original,
            // but it has no invented 720p/FPS claim without metadata.
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
                directUrl: data.play.startsWith('http') ? data.play : `https://www.tikwm.com${data.play}`,
                isCleanNoWatermark: true,
                isVideo: true,
                isDownloadable: true,
                isStreamable: true,
              });
            } else if (!data.hdplay && data.play) {
              // Fallback if the metadata service exposes only one direct URL.
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

          // Audio URL is an original track unless the provider returns its
          // actual bitrate. Never label it 320 kbps based on an estimate.
          if (data.music) {
            const audioBitrate = positiveNumber(data.music_info?.bitrate || data.music_info?.bit_rate || data.music_bitrate);
            const estimatedAudioSize = durationSec && audioBitrate
              ? Math.round(durationSec * (audioBitrate / 8))
              : undefined;
            const musicTitle = data.music_info?.title || data.music_info?.author
              ? `${data.music_info.title || 'Audio'} - ${data.music_info.author || 'TikTok Music'}`
              : `${title} (Audio Track)`;

            formats.push({
              id: 'tiktok_audio',
              label: audioBitrate ? `MP3 ${Math.round(audioBitrate / 1_000)} kbps` : 'Original Audio (MP3)',
              qualityTier: 'audio',
              resolution: audioBitrate ? `${Math.round(audioBitrate / 1_000)} kbps` : undefined,
              ext: 'mp3',
              filesizeBytes: estimatedAudioSize,
              directUrl: data.music.startsWith('http') ? data.music : `https://www.tikwm.com${data.music}`,
              isAudio: true,
              badge: audioBitrate ? `${Math.round(audioBitrate / 1_000)} kbps` : undefined,
              bitrate: audioBitrate,
              audioBitrate,
              sampleRate: positiveNumber(data.music_info?.sample_rate),
              audioChannels: positiveNumber(data.music_info?.channels),
              isDownloadable: true,
              isStreamable: true,
              customTitle: musicTitle,
              customFilename: `${musicTitle}.mp3`,
            });
          }

          // 5. Creator Profile Avatar (Highest Resolution Master with Profile Identity Caption)
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
        /* fallback to secondary provider below */
      }

    // Secondary engine fallback
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
      /* fallback to direct probe */
    }

    return null;
  },
};
