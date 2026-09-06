/**
 * Canonical provider classification for remote uploads.
 *
 * Provider detection belongs to the feature domain instead of UI components so
 * playback, probing and upload resolution all use the same hostname rules.
 */
export type RemoteProvider =
  | 'youtube'
  | 'tiktok'
  | 'twitter'
  | 'instagram'
  | 'pinterest'
  | 'pixiv'
  | 'streamrizz'
  | 'videe'
  | 'vqso'
  | 'pikpak'
  | 'terabox'
  | 'direct'
  | 'unknown';

function normalizedHostname(input: string): string {
  try {
    const value = input.trim();
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return input.trim().toLowerCase().replace(/^www\./, '');
  }
}

function isHostOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/** Classify a URL by provider without inspecting the path or making a request. */
export function detectRemoteProvider(input: string): RemoteProvider {
  const value = input.trim().toLowerCase();
  const hostname = normalizedHostname(value);

  if (isHostOrSubdomain(hostname, 'youtube.com') || hostname === 'youtu.be' || isHostOrSubdomain(hostname, 'googlevideo.com')) return 'youtube';
  if (isHostOrSubdomain(hostname, 'tiktok.com') || isHostOrSubdomain(hostname, 'tiktokcdn.com') || isHostOrSubdomain(hostname, 'douyin.com')) return 'tiktok';
  if (isHostOrSubdomain(hostname, 'twitter.com') || isHostOrSubdomain(hostname, 'x.com') || isHostOrSubdomain(hostname, 'twimg.com')) return 'twitter';
  if (isHostOrSubdomain(hostname, 'instagram.com') || isHostOrSubdomain(hostname, 'cdninstagram.com')) return 'instagram';
  if (isHostOrSubdomain(hostname, 'pinterest.com') || isHostOrSubdomain(hostname, 'pinimg.com')) return 'pinterest';
  if (isHostOrSubdomain(hostname, 'pixiv.net') || isHostOrSubdomain(hostname, 'pximg.net')) return 'pixiv';
  if (isHostOrSubdomain(hostname, 'streamrizz.com') || isHostOrSubdomain(hostname, 'overfetch.video') || hostname.includes('vidoy')) return 'streamrizz';
  if (isHostOrSubdomain(hostname, 'videe.cc') || isHostOrSubdomain(hostname, 'videy.co')) return 'videe';
  if (isHostOrSubdomain(hostname, 'vqso.de') || isHostOrSubdomain(hostname, 'slicedrive.com')) return 'vqso';
  if (hostname.includes('pikpak')) return 'pikpak';
  if (hostname.includes('terabox')) return 'terabox';

  if (/^https?:\/\//i.test(value)) return 'direct';
  return 'unknown';
}

/** Providers that require resolver handling instead of generic direct probing. */
export function hasKnownRemoteProvider(input: string): boolean {
  const provider = detectRemoteProvider(input);
  return provider !== 'direct' && provider !== 'unknown';
}

/** Browser referer required by selected CDN/provider families. */
export function getProviderReferer(input: string): string | undefined {
  const provider = detectRemoteProvider(input);
  switch (provider) {
    case 'streamrizz':
      return 'https://streamrizz.com/';
    case 'twitter':
      return 'https://x.com/';
    case 'tiktok':
      return 'https://www.tiktok.com/';
    case 'youtube':
      return 'https://www.youtube.com/';
    default:
      // Preserve the legacy HLS playback fallback for manifest URLs whose
      // hostname is a resolver/CDN that cannot be classified safely.
      return /\.m3u8(?:\?|$)/i.test(input) ? 'https://www.youtube.com/' : undefined;
  }
}
