import i18n from 'i18next';
import type {
  LinkResolverProvider,
  PlatformKind,
  ResolvedMediaInfo,
  StreamQualityFormat,
} from '../types';
import { assertSafeRemoteUrl } from '../urlSafety';

type CobaltPickerItem = {
  url?: unknown;
  type?: unknown;
  thumb?: unknown;
};

type CobaltResponse = {
  url?: unknown;
  filename?: unknown;
  picker?: unknown;
  audio?: unknown;
};

const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav']);

function platformFor(url: string): { platform: PlatformKind; platformName: string } {
  const normalized = url.toLowerCase();
  if (normalized.includes('facebook.com') || normalized.includes('fb.watch')) {
    return { platform: 'facebook', platformName: 'Facebook' };
  }
  if (normalized.includes('twitter.com') || normalized.includes('x.com')) {
    return { platform: 'twitter', platformName: 'Twitter / X' };
  }
  return { platform: 'instagram', platformName: 'Instagram' };
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return assertSafeRemoteUrl(value.trim()).toString();
  } catch {
    return null;
  }
}

function extensionFor(value: string, fallback: string): string {
  let pathname = value;
  try {
    pathname = new URL(value).pathname;
  } catch {
    // Cobalt may provide a plain filename rather than a URL.
  }
  const filename = pathname.split(/[\\/]/).pop() || '';
  const match = filename.toLowerCase().match(/\.([a-z0-9]{2,8})$/);
  return match?.[1] || fallback;
}

/**
 * Convert only provider-validated media URLs into selectable formats.
 * A social page URL must never be relabelled as a playable MP4 fallback.
 */
export function formatsFromCobalt(
  raw: CobaltResponse,
  platform: PlatformKind,
  platformName: string,
): StreamQualityFormat[] {
  const formats: StreamQualityFormat[] = [];
  const picker = Array.isArray(raw.picker) ? (raw.picker as CobaltPickerItem[]) : [];

  picker.forEach((item, pickerIndex) => {
    const directUrl = safeHttpUrl(item.url);
    if (!directUrl) return;

    const declaredType = typeof item.type === 'string' ? item.type.toLowerCase() : '';
    const inferredExt = extensionFor(directUrl, declaredType.includes('video') ? 'mp4' : 'jpg');
    const isImage = declaredType.includes('photo') || declaredType.includes('image') || IMAGE_EXTENSIONS.has(inferredExt);
    const isAudio = declaredType.includes('audio') || AUDIO_EXTENSIONS.has(inferredExt);

    formats.push({
      id: `${platform}_picker_${pickerIndex + 1}`,
      label: i18n.t('speedtest:remote_social_item', {
        platform: platformName,
        index: pickerIndex + 1,
      }),
      qualityTier: 'original',
      ext: inferredExt,
      directUrl,
      isVideo: !isImage && !isAudio,
      isAudio,
      isImage,
      isCleanNoWatermark: true,
      badge: i18n.t('speedtest:remote_social_validated_badge'),
    });
  });

  const singleUrl = safeHttpUrl(raw.url);
  if (singleUrl && !formats.some((format) => format.directUrl === singleUrl)) {
    const filename = typeof raw.filename === 'string' ? raw.filename : singleUrl;
    const ext = extensionFor(filename, extensionFor(singleUrl, raw.audio ? 'mp3' : 'mp4'));
    const isAudio = Boolean(raw.audio) || AUDIO_EXTENSIONS.has(ext);
    const isImage = IMAGE_EXTENSIONS.has(ext);

    formats.push({
      id: `${platform}_source`,
      label: i18n.t('speedtest:remote_social_original', { platform: platformName }),
      qualityTier: isAudio ? 'audio' : 'original',
      ext,
      directUrl: singleUrl,
      isVideo: !isAudio && !isImage,
      isAudio,
      isImage,
      isCleanNoWatermark: true,
      badge: i18n.t('speedtest:remote_social_validated_badge'),
    });
  }

  return formats;
}

/**
 * Social media resolver for Instagram, Facebook, and Twitter/X.
 * Extraction failure returns null so the registry can continue to the bounded
 * native inspector instead of presenting the original web page as a stream.
 */
export const socialMediaResolver: LinkResolverProvider = {
  name: 'SocialMediaResolver',
  platform: 'instagram',

  canHandle(url: string): boolean {
    const normalized = url.toLowerCase();
    return (
      normalized.includes('instagram.com') ||
      normalized.includes('facebook.com') ||
      normalized.includes('fb.watch')
    );
  },

  async resolve(url: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
    const cleanUrl = url.trim();
    const { platform, platformName } = platformFor(cleanUrl);

    try {
      const response = await fetch('https://api.cobalt.tools/api/json', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: cleanUrl,
          vQuality: 'max',
        }),
        signal: signal || AbortSignal.timeout(6000),
      });

      if (!response.ok) return null;
      const data = (await response.json()) as CobaltResponse;
      const formats = formatsFromCobalt(data, platform, platformName);
      if (formats.length === 0) return null;

      const imageUrls = formats.filter((format) => format.isImage).map((format) => format.directUrl);
      const title = typeof data.filename === 'string' && data.filename.trim()
        ? data.filename.trim()
        : i18n.t('speedtest:remote_social_default_title', { platform: platformName });

      return {
        url: cleanUrl,
        platform,
        platformName,
        title,
        albumImages: imageUrls.length > 1 ? imageUrls : undefined,
        formats,
        selectedFormatId: formats[0].id,
        totalItems: formats.length,
        resolvedAt: Date.now(),
      };
    } catch {
      return null;
    }
  },
};
