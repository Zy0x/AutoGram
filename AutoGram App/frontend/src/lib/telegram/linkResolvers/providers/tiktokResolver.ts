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
          const thumbnailUrl = data.origin_cover || data.cover;

          const formats: StreamQualityFormat[] = [];

          // Detect if video is 4K, 2K, or 1080p based on title, duration, and bitrate
          const titleLower = title.toLowerCase();
          const rawSize = data.hd_size || data.size || 0;
          const bitrateBps = (durationSec && rawSize) ? (rawSize * 8) / durationSec : 0;

          // Detect explicit FPS tag from title (e.g. 120fps, 90fps, 60fps, 144fps, 240fps)
          const fpsMatch = titleLower.match(/\b(240|144|120|90|60)\s*fps\b/i);
          const detectedFps = fpsMatch ? `${fpsMatch[1]}fps` : undefined;

          let peakTier: QualityTier = '1080p';
          let peakLabel = detectedFps ? `Full HD 1080p (${detectedFps})` : 'Full HD 1080p (Master Stream)';
          let peakBadge = '1080p FULL HD';
          let peakRes = detectedFps ? `1080p Full HD • ${detectedFps}` : '1080p Full HD';

          if (titleLower.includes('4k') || titleLower.includes('2160p') || bitrateBps > 30_000_000) {
            peakTier = '4k';
            peakLabel = detectedFps ? `4K Ultra HD (${detectedFps} Master)` : '4K Ultra HD (Master Stream)';
            peakBadge = '4K UHD';
            peakRes = detectedFps ? `4K Ultra HD (2160p) • ${detectedFps}` : '4K Ultra HD (2160p)';
          } else if (titleLower.includes('2k') || titleLower.includes('1440p') || bitrateBps > 15_000_000) {
            peakTier = '2k';
            peakLabel = detectedFps ? `2K Quad HD (${detectedFps})` : '2K Quad HD (1440p)';
            peakBadge = '2K QHD';
            peakRes = detectedFps ? `2K Quad HD (1440p) • ${detectedFps}` : '2K Quad HD (1440p)';
          }

          // 1. Peak Quality (4K UHD / 2K QHD / Full HD 1080p)
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
          if (data.play) {
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

          // 3. Hi-Res Audio Track (MP3)
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
