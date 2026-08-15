import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat } from '../types';

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

    // Try reliable lightweight TikWM API with fallback
    try {
      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}&hd=1`;
      const resp = await fetch(apiUrl, {
        signal: signal || AbortSignal.timeout(8000),
      });

      if (resp.ok) {
        const json = await resp.json();
        if (json && json.data) {
          const data = json.data;
          const title = (data.title || `TikTok_${data.id || Date.now()}`).trim();
          const author = data.author?.nickname ? `@${data.author.unique_id || data.author.nickname}` : undefined;
          const authorAvatar = data.author?.avatar;
          const durationSec = data.duration;
          const thumbnailUrl = data.origin_cover || data.cover;

          const formats: StreamQualityFormat[] = [];

          // 1. HD / Peak Quality (Highest Available)
          if (data.hdplay) {
            formats.push({
              id: 'tiktok_hd_nwm',
              label: 'Kualitas Tertinggi (Tanpa Watermark)',
              qualityTier: '1080p',
              resolution: '1080p Full HD / Sumber Maksimal',
              ext: 'mp4',
              filesizeBytes: data.hd_size || data.size,
              directUrl: data.hdplay.startsWith('http') ? data.hdplay : `https://www.tikwm.com${data.hdplay}`,
              isCleanNoWatermark: true,
              isVideo: true,
              badge: 'KUALITAS TERBAIK (HD)',
            });
          }

          // 2. Standard Clean Video (No Watermark)
          if (data.play) {
            formats.push({
              id: 'tiktok_standard_nwm',
              label: 'Kualitas Standar (Tanpa Watermark)',
              qualityTier: '720p',
              resolution: '720p Standar',
              ext: 'mp4',
              filesizeBytes: data.size,
              directUrl: data.play.startsWith('http') ? data.play : `https://www.tikwm.com${data.play}`,
              isCleanNoWatermark: true,
              isVideo: true,
              badge: 'STANDAR',
            });
          }

          // 3. Audio Only Track (MP3)
          if (data.music) {
            formats.push({
              id: 'tiktok_audio',
              label: `Audio Asli (${data.music_info?.title || 'Track'})`,
              qualityTier: 'audio',
              resolution: '320 kbps',
              ext: 'mp3',
              directUrl: data.music.startsWith('http') ? data.music : `https://www.tikwm.com${data.music}`,
              isAudio: true,
              badge: 'HANYA SUARA',
            });
          }

          if (formats.length > 0) {
            return {
              url: cleanUrl,
              platform: 'tiktok',
              platformName: 'TikTok (Clean No-Watermark)',
              title,
              author,
              authorAvatar,
              durationSec,
              thumbnailUrl,
              formats,
              selectedFormatId: formats[0].id,
              resolvedAt: Date.now(),
            };
          }
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
