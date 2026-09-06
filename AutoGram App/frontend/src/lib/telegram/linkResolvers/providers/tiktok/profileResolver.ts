import { invoke } from '@tauri-apps/api/core';
import type { ResolvedMediaInfo, StreamQualityFormat } from '../../types';

export function isTikTokProfileUrl(url: string): boolean {
  const clean = url.trim().toLowerCase();
  const hasUserHandle = clean.includes('tiktok.com/@') || clean.includes('douyin.com/@');
  return hasUserHandle && !clean.includes('/video/') && !clean.includes('/photo/') && !clean.includes('/story/');
}

export function extractTikTokUsername(url: string): string | null {
  const match = url.trim().match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)(?:\/)?(?:[?#].*)?$/i);
  return match ? match[1] : null;
}

/**
 * Resolves creator profile URLs into rich creator metadata and 1080x1080 master avatar photo.
 */
export async function resolveTikTokProfile(cleanUrl: string, signal?: AbortSignal): Promise<ResolvedMediaInfo | null> {
  const uniqueId = extractTikTokUsername(cleanUrl);
  if (!uniqueId) return null;

  try {
    let nickname: string | undefined;
    let avatarLarger: string | undefined;
    let avatarMedium: string | undefined;
    let signature: string | undefined;

    // 1. Native Rust IPC for rich profile metadata (zero CORS, custom mobile UA)
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
      console.warn('[TikTokResolver] IPC profile fetch failed:', ipcErr);
    }

    // 2. Local dev server proxy fallback
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

    // 3. Native text fetch if not resolved
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

    // 5. Fallback to oEmbed if nickname not resolved yet
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
        customTitle: title,
        customFilename: `${title}.jpg`,
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
      description: signature,
      formats,
      selectedFormatId: formats[0].id,
      resolvedAt: Date.now(),
    };
  } catch (err) {
    console.warn('[TikTokResolver] Failed to resolve TikTok profile:', err);
    return null;
  }
}
