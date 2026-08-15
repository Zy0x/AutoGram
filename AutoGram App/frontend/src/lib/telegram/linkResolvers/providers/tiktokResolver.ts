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

    // 0. Profile URL handler (e.g. https://www.tiktok.com/@tokyo.prompt)
    const profileMatch = cleanUrl.match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)(?:\/)?(?:[?#].*)?$/);
    if (profileMatch && !cleanUrl.includes('/video/') && !cleanUrl.includes('/photo/') && !cleanUrl.includes('/story/')) {
      const uniqueId = profileMatch[1];
      try {
        const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`;
        const resp = await fetch(oembedUrl, { signal: signal || AbortSignal.timeout(6000) });
        if (resp.ok) {
          const odata = await resp.json();
          const authorName = odata.author_name || `@${uniqueId}`;
          const title = `${authorName} - Profil TikTok`;
          return {
            url: cleanUrl,
            platform: 'tiktok',
            platformName: 'TikTok (Creator Profile)',
            title,
            author: `@${uniqueId}`,
            formats: [
              {
                id: 'tiktok_profile_link',
                label: `Informasi Profil (@${uniqueId})`,
                qualityTier: 'original',
                resolution: 'Creator Profile',
                ext: 'txt',
                directUrl: cleanUrl,
                badge: 'PROFIL AKUN',
              },
            ],
            selectedFormatId: 'tiktok_profile_link',
            resolvedAt: Date.now(),
          };
        }
      } catch {
        /* fallback */
      }
    }

    // Try reliable lightweight TikWM API via native Rust IPC (zero CORS) with web fetch fallback
    try {
      let data: any = null;
      if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const json = await invoke<any>('fetch_remote_json_metadata', { url: cleanUrl });
          if (json && json.data) {
            data = json.data;
          }
        } catch (ipcErr) {
          console.warn('[TikTokResolver] IPC fetch failed, falling back to web fetch:', ipcErr);
        }
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
            // A. PHOTO / SLIDESHOW MODE (Full Slideshow Pack & Individual Slides)
            if (data.images.length > 1) {
              formats.push({
                id: 'tiktok_photo_all_pack',
                label: `Semua Foto (${data.images.length} Foto HD - Full Album)`,
                qualityTier: 'original',
                resolution: `Album ${data.images.length} Foto`,
                ext: 'jpg',
                directUrl: data.images[0].startsWith('http') ? data.images[0] : `https://www.tikwm.com${data.images[0]}`,
                isImage: true,
                isCleanNoWatermark: true,
                badge: `FULL ALBUM (${data.images.length})`,
              });
            }

            data.images.forEach((imgUrl: string, idx: number) => {
              formats.push({
                id: `tiktok_photo_${idx + 1}`,
                label: data.images.length === 1 
                  ? 'Foto Original (Clean HD)' 
                  : `Foto ${idx + 1} dari ${data.images.length} (Clean HD)`,
                qualityTier: 'original',
                resolution: 'Original HD Photo',
                ext: 'jpg',
                directUrl: imgUrl.startsWith('http') ? imgUrl : `https://www.tikwm.com${imgUrl}`,
                isImage: true,
                isCleanNoWatermark: true,
                badge: data.images.length === 1 ? 'HD PHOTO' : `FOTO ${idx + 1}`,
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

            // 2. HD 720p (Source Clean Stream)
            if (data.play && data.play !== data.hdplay) {
              formats.push({
                id: 'tiktok_standard_nwm',
                label: 'HD 720p',
                qualityTier: '720p',
                resolution: '720p HD',
                ext: 'mp4',
                filesizeBytes: data.size,
                directUrl: data.play.startsWith('http') ? data.play : `https://www.tikwm.com${data.play}`,
                isCleanNoWatermark: true,
                isVideo: true,
                badge: '720p HD',
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
              label: 'Foto Profil Kreator (HD Avatar)',
              qualityTier: 'original',
              resolution: 'Profile Avatar HD',
              ext: 'jpg',
              directUrl: highestAvatar.startsWith('http') ? highestAvatar : `https://www.tikwm.com${highestAvatar}`,
              isImage: true,
              badge: 'AVATAR HD',
            });
          }

          const effectiveThumb = (Array.isArray(data.images) && data.images.length > 0)
            ? data.images[0]
            : (data.origin_cover || data.cover);

          if (formats.length > 0) {
            return {
              url: cleanUrl,
              platform: 'tiktok',
              platformName: 'TikTok (Clean No-Watermark)',
              title,
              author,
              authorAvatar,
              durationSec,
              thumbnailUrl: effectiveThumb,
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
            platformName: 'TikTok (Clean No-Watermark)',
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
