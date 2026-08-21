import type { LinkResolverProvider, ResolvedMediaInfo } from '../types';
import { directFileResolver } from './directFileResolver';

const HOST_LABELS: Array<[RegExp, string]> = [
  [/(^|\.)pikpak\.(com|me)$/i, 'PikPak'],
  [/(^|\.)videy\.co$/i, 'Videy'],
  [/(^|\.)ace(?:img|file)\.[a-z.]+$/i, 'Ace Host'],
  [/(^|\.)pixeldrain\.com$/i, 'PixelDrain'],
  [/(^|\.)gofile\.io$/i, 'Gofile'],
  [/(^|\.)filedon\.[a-z.]+$/i, 'Filedon'],
  [/(^|\.)cdn\.up2file\.online$/i, 'Up2File CDN'],
  [/(^|\.)cdn\.mp4ko\.de$/i, 'MP4ko CDN'],
  [/(^|\.)tribunvideo\.com$/i, 'Tribun Video'],
  [/(^|\.)vimoy\.[a-z.]+$/i, 'Vimoy'],
  [/(^|\.)vid3\.de$/i, 'Vid3'],
  [/(^|\.)justpaste\.pro$/i, 'JustPaste'],
  [/(^|\.)vdko\.de$/i, 'VDKO'],
  [/(^|\.)vidqy\.me$/i, 'Vidqy'],
  [/(^|\.)cdn\.videayo\.cc$/i, 'Videayo CDN'],
  [/(^|\.)cdn2?\.(?:slicndrive|slicadrivee)[^.]*\.[a-z.]+$/i, 'SlicaDrive CDN'],
  [/(^|\.)(?:media2|video2)\.twimg\.casa$/i, 'Twimg Media'],
  [/(^|\.)cdn2\.vidlyx\.mom$/i, 'Vidlyx CDN'],
  [/(^|\.)cdn\.aceiwmg\.com$/i, 'Ace Image CDN'],
  [/(^|\.)dailymotion\.com$/i, 'Dailymotion'],
  [/(^|\.)mega\.nz$/i, 'MEGA'],
  [/(^|\.)odysee\.com$/i, 'Odysee'],
  [/(^|\.)dtube\.[a-z.]+$/i, 'DTube'],
  [/(^|\.)ok\.ru$/i, 'OK.ru'],
  [/(^|\.)rumble\.com$/i, 'Rumble'],
  [/(^|\.)streamwish\.[a-z.]+$/i, 'StreamWish'],
  [/(^|\.)(?:doodstream|dood)\.[a-z.]+$/i, 'DoodStream'],
  // Keep the generic CDN fallback last so named providers retain their
  // actionable platform identity in the Remote Link UI.
  [/(^|\.)cdn2[^.]*\.[a-z.]+$/i, 'CDN2'],
];

export function identifyKnownRemoteHost(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return HOST_LABELS.find(([pattern]) => pattern.test(host))?.[1] || null;
  } catch {
    return null;
  }
}

/**
 * Recognises common file hosts and follows normal HTTP redirects through the
 * universal inspector. It never clicks ads, bypasses interstitials, or joins
 * Telegram chats; HTML landing pages remain explicit user handoffs.
 */
export const knownRemoteHostResolver: LinkResolverProvider = {
  name: 'KnownRemoteHostResolver',
  platform: 'direct',
  canHandle: (url) => identifyKnownRemoteHost(url) != null,
  async resolve(url, signal): Promise<ResolvedMediaInfo | null> {
    const label = identifyKnownRemoteHost(url);
    if (!label) return null;
    const resolved = await directFileResolver.resolve(url, signal);
    return resolved ? { ...resolved, platformName: label } : null;
  },
};
