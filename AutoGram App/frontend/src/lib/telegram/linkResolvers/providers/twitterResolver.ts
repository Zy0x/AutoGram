import i18n from 'i18next';
import type {
  LinkResolverProvider,
  QualityTier,
  ResolvedMediaInfo,
  ResolvedMediaItem,
  StreamQualityFormat,
} from '../types';
import { assertSafeRemoteUrl } from '../urlSafety';

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return assertSafeRemoteUrl(value.trim()).toString();
  } catch {
    return null;
  }
}

function extractStatusId(url: string): string | null {
  const match = url.match(/status(?:es)?\/(\d+)/i);
  return match ? match[1] : null;
}

function inferTierAndBadge(
  width?: number,
  height?: number,
  bitrate?: number
): { tier: QualityTier; badge: string; resolution: string } {
  const shortDim = width && height ? Math.min(width, height) : (width || height || 0);
  const dimStr = width && height ? `${width} × ${height}` : '';

  if (shortDim >= 2100) {
    return { tier: '4k', badge: dimStr || '4K UHD', resolution: dimStr ? `4K UHD (${dimStr})` : '4K UHD' };
  }
  if (shortDim >= 1400) {
    return { tier: '2k', badge: dimStr || '2K QHD', resolution: dimStr ? `2K QHD (${dimStr})` : '2K QHD' };
  }
  if (shortDim >= 1000) {
    return { tier: '1080p', badge: dimStr || '1080p FHD', resolution: dimStr ? `1080p FHD (${dimStr})` : '1080p Full HD' };
  }
  if (shortDim >= 700) {
    return { tier: '720p', badge: dimStr || '720p HD', resolution: dimStr ? `720p HD (${dimStr})` : '720p HD' };
  }
  if (shortDim >= 450) {
    return { tier: '480p', badge: dimStr || '480p SD', resolution: dimStr ? `480p SD (${dimStr})` : '480p SD' };
  }
  if (shortDim > 0) {
    return { tier: '360p', badge: dimStr || `${shortDim}p`, resolution: dimStr ? `${shortDim}p (${dimStr})` : `${shortDim}p` };
  }
  if (bitrate && bitrate > 1500000) {
    return { tier: '720p', badge: '720p HD', resolution: '720p HD' };
  }
  if (bitrate && bitrate > 800000) {
    return { tier: '480p', badge: '480p SD', resolution: '480p SD' };
  }
  return { tier: 'original', badge: 'HD VIDEO', resolution: 'HD Video' };
}

function parseDimensionsFromUrl(url: string): { width?: number; height?: number } {
  const match = url.match(/[/_](\d{2,5})x(\d{2,5})[/._]/i);
  if (match) {
    return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
  }
  return {};
}

/**
 * Twitter / X Media Resolver
 * Resolves videos, multi-video posts, GIFs, and photo albums with multi-bitrate quality tiers.
 */
export const twitterResolver: LinkResolverProvider = {
  name: 'TwitterResolver',
  platform: 'twitter',

  canHandle(url: string): boolean {
    const normalized = url.toLowerCase();
    const isTwitterHost =
      normalized.includes('twitter.com') ||
      normalized.includes('x.com') ||
      normalized.includes('fxtwitter.com') ||
      normalized.includes('vxtwitter.com') ||
      normalized.includes('fixupx.com');
    return isTwitterHost && Boolean(extractStatusId(url));
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    const statusId = extractStatusId(cleanUrl);
    if (!statusId) return null;

    // 1. Primary backend: FxTwitter API
    try {
      const fxUrl = `https://api.fxtwitter.com/i/status/${statusId}`;
      const response = await fetch(fxUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: signal || AbortSignal.timeout(7000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data && (data.code === 200 || data.tweet) && data.tweet) {
          const tweet = data.tweet;
          const authorName = tweet.author?.name || '';
          const authorHandle = tweet.author?.screen_name ? `@${tweet.author.screen_name}` : '';
          const author = authorName ? (authorHandle ? `${authorName} (${authorHandle})` : authorName) : authorHandle;
          const authorAvatar = safeHttpUrl(tweet.author?.avatar_url) || undefined;
          const rawTitle = (tweet.text || '').trim();
          const cleanTitle = rawTitle.replace(/https?:\/\/t\.co\/\w+/gi, '').trim() || `Twitter Post (${statusId})`;

          const videos = Array.isArray(tweet.media?.videos) ? tweet.media.videos : [];
          const photos = Array.isArray(tweet.media?.photos) ? tweet.media.photos : [];

          // Video Tweet Handling
          if (videos.length > 0) {
            const primaryVideo = videos[0];
            const durationSec = primaryVideo.duration ? Math.round(primaryVideo.duration) : undefined;
            const thumbnailUrl = safeHttpUrl(primaryVideo.thumbnail_url) || undefined;

            const mp4Variants = (primaryVideo.variants || primaryVideo.formats || []).filter((v: any) => {
              const u = typeof v.url === 'string' ? v.url : '';
              const ct = typeof v.content_type === 'string' ? v.content_type : '';
              const container = typeof v.container === 'string' ? v.container : '';
              return (ct === 'video/mp4' || container === 'mp4' || u.includes('.mp4')) && safeHttpUrl(u);
            });

            // Sort by bitrate descending
            mp4Variants.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

            const formats: StreamQualityFormat[] = [];
            const seenUrls = new Set<string>();

            for (let i = 0; i < mp4Variants.length; i++) {
              const v = mp4Variants[i];
              const directUrl = safeHttpUrl(v.url);
              if (!directUrl || seenUrls.has(directUrl)) continue;
              seenUrls.add(directUrl);

              const parsedDims = parseDimensionsFromUrl(directUrl);
              const w = parsedDims.width || primaryVideo.width;
              const h = parsedDims.height || primaryVideo.height;
              const { tier, badge, resolution } = inferTierAndBadge(w, h, v.bitrate);

              // Estimate filesize from bitrate & duration if duration exists
              const estimatedBytes =
                v.bitrate && durationSec && durationSec > 0
                  ? Math.round((v.bitrate * durationSec) / 8)
                  : undefined;

              formats.push({
                id: `twitter_video_${i + 1}_${tier}`,
                label: resolution,
                qualityTier: tier,
                resolution,
                filesizeBytes: estimatedBytes,
                ext: 'mp4',
                directUrl,
                isVideo: true,
                isAudio: false,
                isImage: false,
                isCleanNoWatermark: true,
                badge,
                thumbnailUrl,
              });
            }

            // Fallback to primary video direct URL if variants array was empty
            if (formats.length === 0 && primaryVideo.url) {
              const directUrl = safeHttpUrl(primaryVideo.url);
              if (directUrl) {
                const parsedDims = parseDimensionsFromUrl(directUrl);
                const { tier, badge, resolution } = inferTierAndBadge(
                  primaryVideo.width || parsedDims.width,
                  primaryVideo.height || parsedDims.height
                );
                formats.push({
                  id: 'twitter_video_source',
                  label: resolution,
                  qualityTier: tier,
                  resolution,
                  ext: 'mp4',
                  directUrl,
                  isVideo: true,
                  isAudio: false,
                  isImage: false,
                  isCleanNoWatermark: true,
                  badge,
                  thumbnailUrl,
                });
              }
            }

            if (formats.length > 0) {
              // Multi-video post
              let mediaItems: ResolvedMediaItem[] | undefined;
              if (videos.length > 1) {
                mediaItems = videos.map((vid: any, vIdx: number) => {
                  const vThumb = safeHttpUrl(vid.thumbnail_url) || undefined;
                  const vDirect = safeHttpUrl(vid.url) || formats[0].directUrl;
                  const vDur = vid.duration ? Math.round(vid.duration) : undefined;
                  return {
                    id: `twitter_vid_item_${vIdx + 1}`,
                    title: `${cleanTitle} (Part ${vIdx + 1})`,
                    thumbnailUrl: vThumb,
                    durationSec: vDur,
                    kind: 'video',
                    selectedFormatId: `twitter_vid_${vIdx + 1}`,
                    formats: [
                      {
                        id: `twitter_vid_${vIdx + 1}`,
                        label: 'HD Video',
                        qualityTier: 'original',
                        resolution: 'HD Video',
                        ext: 'mp4',
                        directUrl: vDirect,
                        isVideo: true,
                        isCleanNoWatermark: true,
                        badge: 'HD',
                        thumbnailUrl: vThumb,
                      },
                    ],
                  };
                });
              }

              return {
                url: cleanUrl,
                platform: 'twitter',
                platformName: 'Twitter / X',
                title: cleanTitle,
                author,
                authorAvatar,
                durationSec,
                thumbnailUrl,
                formats,
                selectedFormatId: formats[0].id,
                mediaItems,
                totalItems: mediaItems ? mediaItems.length : 1,
                resolvedAt: Date.now(),
              };
            }
          }

          // Photo Tweet Handling
          if (photos.length > 0) {
            const albumImages: string[] = [];
            const formats: StreamQualityFormat[] = [];

            photos.forEach((photo: any, pIdx: number) => {
              const photoUrl = safeHttpUrl(photo.url);
              if (!photoUrl) return;
              albumImages.push(photoUrl);

              formats.push({
                id: `twitter_photo_${pIdx + 1}`,
                label: i18n.t('speedtest:remote_photo_n', {
                  idx: pIdx + 1,
                  total: photos.length,
                }),
                qualityTier: 'original',
                resolution: photo.width && photo.height ? `${photo.width}x${photo.height}` : 'HD Photo',
                ext: 'jpg',
                directUrl: photoUrl,
                isVideo: false,
                isAudio: false,
                isImage: true,
                isCleanNoWatermark: true,
                badge: 'PHOTO HD',
                thumbnailUrl: photoUrl,
              });
            });

            if (albumImages.length > 1) {
              formats.unshift({
                id: 'twitter_photo_all_pack',
                label: i18n.t('speedtest:remote_album_full_pack', { count: albumImages.length }),
                qualityTier: 'original',
                ext: 'jpg',
                directUrl: albumImages[0],
                isVideo: false,
                isAudio: false,
                isImage: true,
                isAlbumPack: true,
                allAlbumUrls: albumImages,
                badge: 'ALBUM PACK',
              });
            }

            if (formats.length > 0) {
              return {
                url: cleanUrl,
                platform: 'twitter',
                platformName: 'Twitter / X',
                title: cleanTitle,
                author,
                authorAvatar,
                thumbnailUrl: albumImages[0],
                albumImages,
                formats,
                selectedFormatId: formats[0].id,
                totalItems: albumImages.length,
                resolvedAt: Date.now(),
              };
            }
          }
        }
      }
    } catch {
      /* FxTwitter failed, fallback to VxTwitter */
    }

    // 2. Fallback backend: VxTwitter API
    try {
      const vxUrl = `https://api.vxtwitter.com/i/status/${statusId}`;
      const vxResp = await fetch(vxUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        signal: signal || AbortSignal.timeout(6000),
      });

      if (vxResp.ok) {
        const vxData = await vxResp.json();
        if (vxData && (vxData.mediaURLs || vxData.media_extended)) {
          const author = vxData.user_name
            ? `${vxData.user_name} (@${vxData.user_screen_name || ''})`
            : vxData.user_screen_name || '';
          const rawTitle = (vxData.text || '').trim();
          const cleanTitle = rawTitle.replace(/https?:\/\/t\.co\/\w+/gi, '').trim() || `Twitter Post (${statusId})`;

          const mediaExtended = Array.isArray(vxData.media_extended) ? vxData.media_extended : [];
          const formats: StreamQualityFormat[] = [];
          const albumImages: string[] = [];

          for (let i = 0; i < mediaExtended.length; i++) {
            const item = mediaExtended[i];
            const directUrl = safeHttpUrl(item.url);
            if (!directUrl) continue;

            const isVideo = item.type === 'video' || item.type === 'gif';
            const isImage = item.type === 'image';
            const thumb = safeHttpUrl(item.thumbnail_url) || (isImage ? directUrl : undefined);

            if (isImage) {
              albumImages.push(directUrl);
            }

            formats.push({
              id: `twitter_vx_${i + 1}`,
              label: isVideo ? 'HD Video' : `Photo ${i + 1}`,
              qualityTier: 'original',
              resolution: item.size?.width && item.size?.height ? `${item.size.width}x${item.size.height}` : 'HD',
              ext: isVideo ? 'mp4' : 'jpg',
              directUrl,
              isVideo,
              isAudio: false,
              isImage,
              isCleanNoWatermark: true,
              badge: isVideo ? 'HD VIDEO' : 'PHOTO HD',
              thumbnailUrl: thumb,
            });
          }

          if (formats.length > 0) {
            return {
              url: cleanUrl,
              platform: 'twitter',
              platformName: 'Twitter / X',
              title: cleanTitle,
              author,
              thumbnailUrl: formats[0].thumbnailUrl || (albumImages.length > 0 ? albumImages[0] : undefined),
              albumImages: albumImages.length > 0 ? albumImages : undefined,
              formats,
              selectedFormatId: formats[0].id,
              totalItems: formats.length,
              resolvedAt: Date.now(),
            };
          }
        }
      }
    } catch {
      /* VxTwitter failed */
    }

    return null;
  },
};
