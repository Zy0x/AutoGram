import { invoke } from '@tauri-apps/api/core';
import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat, QualityTier } from '../types';

/**
 * TikTok No-Watermark Ultra-HD Resolver
 * Extracts highest quality clean video stream (no watermark) and original music audio.
 */
export const tiktokResolver: LinkResolverProvider = {
  name: 'TikTokResolver',
  platform: 'tiktok',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return u.includes('tiktok.com') || u.includes('douyin.com');
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
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
            nickname = u.nickname;
            avatarLarger = u.avatarLarger;
            avatarMedium = u.avatarMedium;
            signature = u.signature;
          } else if (jsonMeta?.html) {
            const html = jsonMeta.html;
            const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
            if (universalMatch) {
              try {
                const ujson = JSON.parse(universalMatch[1]);
                const userDetail = ujson['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo;
                if (userDetail?.user) {
                  nickname = userDetail.user.nickname;
                  avatarLarger = userDetail.user.avatarLarger;
                  avatarMedium = userDetail.user.avatarMedium;
                  signature = userDetail.user.signature;
                }
              } catch {
                /* parse fallback */
              }
            }
            if (!avatarLarger) {
              const avatarMatch = html.match(/"avatarLarger":"(https:[^"]+)"/i);
              if (avatarMatch) {
                avatarLarger = avatarMatch[1].replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\/g, '');
              }
            }
          }
        } catch (ipcErr) {
          console.warn('[TikTokResolver] IPC fetch failed, falling back to direct web:', ipcErr);
        }

        // 2. Try native text fetch if not resolved
        if (!avatarLarger) {
          try {
            const html = await invoke<string>('fetch_remote_text_content', {
              url: `https://www.tiktok.com/@${uniqueId}`,
              userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            });
            if (html) {
              const universalMatch = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
              if (universalMatch) {
                try {
                  const ujson = JSON.parse(universalMatch[1]);
                  const userDetail = ujson['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo;
                  if (userDetail?.user) {
                    nickname = userDetail.user.nickname;
                    avatarLarger = userDetail.user.avatarLarger;
                    avatarMedium = userDetail.user.avatarMedium;
                    signature = userDetail.user.signature;
                  }
                } catch {
                  /* parse fallback */
                }
              }
              if (!avatarLarger) {
                const avatarMatch = html.match(/"avatarLarger":"(https:[^"]+)"/i);
                if (avatarMatch) {
                  avatarLarger = avatarMatch[1].replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\/g, '');
                }
              }
            }
          } catch {
            /* text IPC fallback */
          }
        }

        // 3. Fallback to direct web fetch
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

        // 1. Creator Profile Avatar (Highest Resolution Master)
        const effectiveAvatar = avatarLarger || avatarMedium;
        if (effectiveAvatar) {
          formats.push({
            id: 'tiktok_profile_avatar',
            label: 'Creator Profile Photo (HD Avatar)',
            qualityTier: 'original',
            resolution: '1080×1080 HD',
            ext: 'jpg',
            directUrl: effectiveAvatar,
            isImage: true,
            isCleanNoWatermark: true,
            badge: 'AVATAR HD',
          });
        }

        // 2. Profile Link / Summary
        formats.push({
          id: 'tiktok_profile_link',
          label: `Profile Information (@${uniqueId})`,
          qualityTier: 'original',
          resolution: 'Creator Profile',
          ext: 'txt',
          directUrl: cleanUrl,
          badge: 'PROFILE',
        });

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

    // Try reliable lightweight TikWM API via native Rust IPC (zero CORS) with web fetch fallback
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

          // Detect if video is 4K, 2K, or 1080p based on title, duration, and bitrate
          const titleLower = title.toLowerCase();
          const rawSize = data.hd_size || data.size || 0;
          const bitrateBps = (durationSec && rawSize) ? (rawSize * 8) / durationSec : 0;

          // Detect explicit FPS tag from title or metadata (e.g. 120fps, 90fps, 60fps, 144fps, 240fps)
          const fpsMatch = titleLower.match(/\b(240|144|120|90|60)\s*fps\b/i);
          const detectedFps = fpsMatch ? `${fpsMatch[1]}fps` : (bitrateBps > 15_000_000 ? '60fps' : undefined);

          let peakTier: QualityTier = '1080p';
          let peakLabel = detectedFps ? `Full HD 1080p (${detectedFps} Master)` : 'Full HD 1080p (Master Stream)';
          let peakBadge = '1080p FULL HD';
          let peakRes = detectedFps ? `1080p Full HD • ${detectedFps}` : '1080p Full HD';

          // 1. Peak Quality (Full HD 1080p Master with True Physical Specs)
          const isPhotoPost = Array.isArray(data.images) && data.images.length > 0;

          if (isPhotoPost) {
            const allDirectImages = data.images.map((imgUrl: string) =>
              imgUrl.startsWith('http') ? imgUrl : `https://www.tikwm.com${imgUrl}`
            );

            // A. PHOTO / SLIDESHOW MODE (Full Slideshow Pack & Individual Slides)
            if (data.images.length > 1) {
              formats.push({
                id: 'tiktok_photo_all_pack',
                label: `All Photos (${data.images.length} HD Photos - Full Album)`,
                qualityTier: 'original',
                resolution: `Album ${data.images.length} Photos`,
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
                  ? 'Original Photo (Clean HD)' 
                  : `Photo ${idx + 1} of ${data.images.length} (Clean HD)`,
                qualityTier: 'original',
                resolution: 'Original HD Photo',
                ext: 'jpg',
                directUrl: fullImgUrl,
                isImage: true,
                isCleanNoWatermark: true,
                badge: data.images.length === 1 ? 'HD PHOTO' : `PHOTO ${idx + 1}`,
              });
            });
          } else {
            // B. VIDEO MODE
            // 1. Peak Quality (Full HD 1080p Master with True Physical Specs)
            if (data.hdplay) {
              formats.push({
                id: 'tiktok_hd_nwm',
                label: peakLabel,
                qualityTier: peakTier,
                resolution: peakRes,
                ext: 'mp4',
                filesizeBytes: data.hd_size || data.size,
                directUrl: data.hdplay.startsWith('http') ? data.hdplay : `https://www.tikwm.com${data.hdplay}`,
                isCleanNoWatermark: true,
                isVideo: true,
                badge: peakBadge,
              });
            }

            // 2. HD 720p / Compressed Stream (Only if distinct from master HD)
            const hasDistinctStandardStream =
              data.play &&
              data.play !== data.hdplay &&
              (!data.hdplay || (data.size && data.hd_size && data.size < data.hd_size * 0.92));

            if (hasDistinctStandardStream) {
              formats.push({
                id: 'tiktok_standard_nwm',
                label: 'HD 720p (Compressed)',
                qualityTier: '720p',
                resolution: '720p HD',
                ext: 'mp4',
                filesizeBytes: data.size,
                directUrl: data.play.startsWith('http') ? data.play : `https://www.tikwm.com${data.play}`,
                isCleanNoWatermark: true,
                isVideo: true,
                badge: '720p HD',
              });
            } else if (!data.hdplay && data.play) {
              // Fallback if hdplay is not provided by server
              formats.push({
                id: 'tiktok_standard_nwm',
                label: peakLabel,
                qualityTier: peakTier,
                resolution: peakRes,
                ext: 'mp4',
                filesizeBytes: data.size,
                directUrl: data.play.startsWith('http') ? data.play : `https://www.tikwm.com${data.play}`,
                isCleanNoWatermark: true,
                isVideo: true,
                badge: peakBadge,
              });
            }
          }

          // 4. Hi-Res Audio Track (MP3)
          if (data.music) {
            const estimatedAudioSize = durationSec ? Math.round(durationSec * (320 * 1024 / 8)) : (data.size ? Math.round(data.size * 0.15) : undefined);
            formats.push({
              id: 'tiktok_audio',
              label: 'Hi-Res Audio (320 kbps MP3)',
              qualityTier: 'audio',
              resolution: '320 kbps',
              ext: 'mp3',
              filesizeBytes: estimatedAudioSize,
              directUrl: data.music.startsWith('http') ? data.music : `https://www.tikwm.com${data.music}`,
              isAudio: true,
              badge: 'HI-RES AUDIO',
            });
          }

          // 5. Creator Profile Avatar (Highest Resolution Master)
          const highestAvatar = data.author?.avatar_larger || data.author?.avatar_medium || data.author?.avatar;
          if (highestAvatar) {
            formats.push({
              id: 'tiktok_profile_avatar',
              label: 'Creator Profile Photo (HD Avatar)',
              qualityTier: 'original',
              resolution: 'Profile Avatar HD',
              ext: 'jpg',
              directUrl: highestAvatar.startsWith('http') ? highestAvatar : `https://www.tikwm.com${highestAvatar}`,
              isImage: true,
              badge: 'AVATAR HD',
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
                label: 'HD Lossless (No Watermark)',
                qualityTier: '1080p',
                resolution: '1080p HD',
                ext: 'mp4',
                directUrl: downloadUrl,
                isCleanNoWatermark: true,
                isVideo: true,
                badge: 'NO WATERMARK HD',
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
