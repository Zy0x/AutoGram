import { invoke } from '@tauri-apps/api/core';
import type { LinkResolverProvider, ResolvedMediaInfo, StreamQualityFormat, ResolveOptions } from '../types';

/**
 * PikPak Public & Protected Share Link Resolver
 * Integrates PikPak Shield dynamic signing, passcode handling, folder recursion,
 * and direct high-speed CDN stream extraction.
 */

interface PikPakFileItem {
  id: string;
  name: string;
  kind?: string; // 'drive#file' | 'drive#folder'
  size?: string | number;
  mime_type?: string;
  file_extension?: string;
  web_content_link?: string;
  thumbnail_link?: string;
  icon_link?: string;
  hash?: string;
  links?: {
    download?: {
      url?: string;
    };
  };
  medias?: Array<{
    media_id?: string;
    media_name?: string;
    link?: {
      url?: string;
    };
  }>;
}

interface PikPakShareResponse {
  share_status?: string; // 'OK' | 'PASS_CODE_REQUIRED' | 'PASS_CODE_ERROR' | 'NOT_FOUND' | 'EXPIRED'
  share_status_text?: string;
  title?: string;
  files?: PikPakFileItem[];
  pass_code_token?: string;
  thumbnail_link?: string;
  user_info?: {
    nickname?: string;
    avatar?: string;
    user_id?: string;
  };
  file_num?: string | number;
}

const PIKPAK_SHIELD_CONFIG = {
  clientId: 'YUMx5nI8ZU8Ap8pm',
  clientVersion: 'undefined',
  packageName: 'drive.mypikpak.com',
  timestamp: '1787297641205',
  algorithms: [
    { alg: 'md5', salt: 'fyZ4+p77W1U4zcWBUwefAIFhFxvADWtT1wzolCxhg9q7etmGUjXr' },
    { alg: 'md5', salt: 'uSUX02HYJ1IkyLdhINEFcCf7l2' },
    { alg: 'md5', salt: 'iWt97bqD/qvjIaPXB2Ja5rsBWtQtBZZmaHH2rMR41' },
    { alg: 'md5', salt: '3binT1s/5a1pu3fGsN' },
    { alg: 'md5', salt: '8YCCU+AIr7pg+yd7CkQEY16lDMwi8Rh4WNp5' },
    { alg: 'md5', salt: 'DYS3StqnAEKdGddRP8CJrxUSFh' },
    { alg: 'md5', salt: 'crquW+4' },
    { alg: 'md5', salt: 'ryKqvW9B9hly+JAymXCIfag5Z' },
    { alg: 'md5', salt: 'Hr08T/NDTX1oSJfHk90c' },
    { alg: 'md5', salt: 'i' },
  ],
};

function md5Hex(input: string): string {
  let k = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  let s = [
    7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
    5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
    4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
    6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,
  ];

  let utf8: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code < 0x80) utf8.push(code);
    else if (code < 0x800) {
      utf8.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      utf8.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      i++;
      code = 0x10000 + (((code & 0x3ff) << 10) | (input.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }

  let originalLength = utf8.length * 8;
  utf8.push(0x80);
  while ((utf8.length % 64) !== 56) utf8.push(0);

  let lowBits = originalLength >>> 0;
  let highBits = Math.floor(originalLength / 0x100000000);
  for (let i = 0; i < 4; i++) utf8.push((lowBits >>> (i * 8)) & 0xff);
  for (let i = 0; i < 4; i++) utf8.push((highBits >>> (i * 8)) & 0xff);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let i = 0; i < utf8.length; i += 64) {
    let w: number[] = [];
    for (let j = 0; j < 16; j++) {
      w[j] =
        utf8[i + j * 4] |
        (utf8[i + j * 4 + 1] << 8) |
        (utf8[i + j * 4 + 2] << 16) |
        (utf8[i + j * 4 + 3] << 24);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) {
        f = (b & c) | (~b & d);
        g = j;
      } else if (j < 32) {
        f = (d & b) | (~d & c);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = b ^ c ^ d;
        g = (3 * j + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * j) % 16;
      }

      let temp = d;
      d = c;
      c = b;
      let sum = (a + f + k[j] + w[g]) >>> 0;
      let rotated = ((sum << s[j]) | (sum >>> (32 - s[j]))) >>> 0;
      b = (b + rotated) >>> 0;
      a = temp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const toHex = (n: number) => {
    let hex = '';
    for (let i = 0; i < 4; i++) {
      let byte = (n >>> (i * 8)) & 0xff;
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  };

  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

function generateDeviceId(): string {
  let hex = '';
  for (let i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

function calculateCaptchaSign(deviceId: string): string {
  const conf = PIKPAK_SHIELD_CONFIG;
  const seed = '' + conf.clientId + conf.clientVersion + conf.packageName + deviceId + conf.timestamp;
  const res = conf.algorithms.reduce(
    (acc, f) => ({ salt: md5Hex(acc.salt + f.salt) }),
    { salt: seed }
  );
  return `1.${res.salt}`;
}

let cachedCaptchaToken: { token: string; deviceId: string; expiresAt: number } | null = null;

async function getPikPakCaptchaToken(signal?: AbortSignal): Promise<{ token: string; deviceId: string }> {
  if (cachedCaptchaToken && cachedCaptchaToken.expiresAt > Date.now() + 15000) {
    return { token: cachedCaptchaToken.token, deviceId: cachedCaptchaToken.deviceId };
  }

  const deviceId = generateDeviceId();
  const sign = calculateCaptchaSign(deviceId);

  const payload = {
    client_id: PIKPAK_SHIELD_CONFIG.clientId,
    device_id: deviceId,
    action: 'GET:/drive/v1/share',
    meta: {
      captcha_sign: sign,
      client_version: PIKPAK_SHIELD_CONFIG.clientVersion,
      package_name: PIKPAK_SHIELD_CONFIG.packageName,
      user_id: '',
      timestamp: PIKPAK_SHIELD_CONFIG.timestamp,
    },
  };

  const resp = await fetch('https://user.mypikpak.com/v1/shield/captcha/init', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'x-device-id': deviceId,
      'x-client-id': PIKPAK_SHIELD_CONFIG.clientId,
    },
    body: JSON.stringify(payload),
    signal: signal || AbortSignal.timeout(8000),
  });

  if (!resp.ok) {
    throw new Error(`PikPak shield captcha init failed: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  if (!data?.captcha_token) {
    throw new Error(data?.error_description || 'Failed to acquire PikPak captcha token');
  }

  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 240;
  cachedCaptchaToken = {
    token: data.captcha_token,
    deviceId,
    expiresAt: Date.now() + expiresInSec * 1000,
  };

  return { token: data.captcha_token, deviceId };
}

export function parsePikPakShareInfo(rawUrl: string): { shareId: string; passcode?: string } | null {
  const clean = rawUrl.trim();
  try {
    const urlObj = new URL(clean.split(/\s+/)[0]);
    const host = urlObj.hostname.toLowerCase();
    if (!host.includes('pikpak')) return null;

    let shareId = '';
    const match = urlObj.pathname.match(/\/(?:drive\/)?s\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      shareId = match[1];
    } else if (urlObj.searchParams.has('share_id')) {
      shareId = urlObj.searchParams.get('share_id') || '';
    }

    if (!shareId) return null;

    let passcode =
      urlObj.searchParams.get('pwd') ||
      urlObj.searchParams.get('pass_code') ||
      urlObj.searchParams.get('code') ||
      urlObj.searchParams.get('passcode') ||
      undefined;

    if (!passcode && urlObj.hash) {
      const hashVal = urlObj.hash.replace(/^#/, '').trim();
      if (/^[a-zA-Z0-9]{4,12}$/.test(hashVal)) {
        passcode = hashVal;
      }
    }

    if (!passcode) {
      const textMatch = clean.match(/(?:pwd|pass|code|password|kode|sandi|提取码|密码)[:=\s]+([a-zA-Z0-9]{4,12})/i);
      if (textMatch && textMatch[1]) {
        passcode = textMatch[1].trim();
      }
    }

    return { shareId, passcode };
  } catch {
    const match = clean.match(/pikpak\.[a-z.]+\/(?:drive\/)?s\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      const shareId = match[1];
      const textMatch = clean.match(/(?:pwd|pass|code|password|kode|sandi|提取码|密码)[:=\s]+([a-zA-Z0-9]{4,12})/i);
      return { shareId, passcode: textMatch ? textMatch[1].trim() : undefined };
    }
    return null;
  }
}

async function fetchPikPakShareData(
  shareId: string,
  passCode?: string,
  folderId?: string,
  fileId?: string,
  signal?: AbortSignal
): Promise<PikPakShareResponse> {
  // 1. Try native Rust IPC first (zero browser CORS)
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const resp = await invoke<PikPakShareResponse>('fetch_pikpak_share_meta', {
        shareId,
        passCode: passCode || null,
        folderId: folderId || null,
        fileId: fileId || null,
      });
      if (resp && (resp.share_status || resp.files || resp.title || (resp as any).error_code !== undefined)) {
        return resp;
      }
    } catch (ipcErr) {
      console.warn('[PikPakResolver] Tauri IPC fetch failed, trying web fallback:', ipcErr);
    }
  }

  // 2. Web browser fallback with shield captcha token
  const { token: captchaToken, deviceId } = await getPikPakCaptchaToken(signal);

  let targetApiUrl = folderId
    ? `https://api-drive.mypikpak.com/drive/v1/share/detail?share_id=${encodeURIComponent(
        shareId
      )}&parent_id=${encodeURIComponent(folderId)}&limit=100`
    : fileId
      ? `https://api-drive.mypikpak.com/drive/v1/share/file_info?share_id=${encodeURIComponent(
          shareId
        )}&file_id=${encodeURIComponent(fileId)}`
      : `https://api-drive.mypikpak.com/drive/v1/share?share_id=${encodeURIComponent(shareId)}`;

  if (passCode) {
    targetApiUrl += `&pass_code=${encodeURIComponent(passCode)}`;
  }

  const shareResp = await fetch(targetApiUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'x-device-id': deviceId,
      'x-client-id': PIKPAK_SHIELD_CONFIG.clientId,
      'x-captcha-token': captchaToken,
      Accept: 'application/json',
    },
    signal: signal || AbortSignal.timeout(10000),
  });

  return (await shareResp.json()) as PikPakShareResponse;
}

export const pikpakResolver: LinkResolverProvider = {
  name: 'PikPakResolver',
  platform: 'pikpak',

  canHandle(url: string): boolean {
    const u = url.toLowerCase();
    return (
      u.includes('mypikpak.com') ||
      u.includes('pikpak.me') ||
      u.includes('api-drive.mypikpak.com')
    );
  },

  async resolve(url: string, signal?: AbortSignal, options?: ResolveOptions): Promise<ResolvedMediaInfo | null> {
    const parsed = parsePikPakShareInfo(url);
    if (!parsed) return null;

    const { shareId } = parsed;
    const passCode = options?.passcode?.trim() || parsed.passcode?.trim() || '';

    const shareData = await fetchPikPakShareData(shareId, passCode, undefined, undefined, signal);
    const shareStatus = String(shareData.share_status || '').toUpperCase();

    // 1. Handle Passcode Required / Error
    if (shareStatus === 'PASS_CODE_REQUIRED' || shareStatus === 'PASS_CODE_ERROR') {
      const isError = shareStatus === 'PASS_CODE_ERROR';
      return {
        url: url.trim(),
        platform: 'pikpak',
        platformName: 'PikPak Cloud',
        title: shareData.title || (isError ? 'PikPak (Invalid Passcode)' : 'PikPak (Passcode Required)'),
        thumbnailUrl: shareData.thumbnail_link || undefined,
        description: isError
          ? 'The entered passcode is incorrect. Please provide the correct passcode.'
          : 'This PikPak share link is protected with a password. Please enter the passcode to view and download files.',
        formats: [
          {
            id: 'pikpak_passcode_req',
            label: isError ? 'Passcode Error / Kode Sandi Salah' : 'Password Protected / Perlu Kode Sandi',
            qualityTier: 'original',
            ext: 'bin',
            directUrl: url.trim(),
            badge: isError ? 'PASSCODE ERROR' : 'PASSWORD PROTECTED',
          },
        ],
        selectedFormatId: 'pikpak_passcode_req',
        requiresPassword: true,
        passwordError: isError,
        isDirectFile: false,
        resolvedAt: Date.now(),
      };
    }

    // 2. Handle Not Found / Expired
    if (shareStatus === 'NOT_FOUND' || shareStatus === 'EXPIRED') {
      throw new Error(shareData.share_status_text || 'PikPak shared link has expired or does not exist');
    }

    // 3. Process Files & Folders
    let rawFiles: PikPakFileItem[] = shareData.files || [];

    // If folders exist in share, recursively fetch child files
    const allFiles: PikPakFileItem[] = [];
    for (const item of rawFiles) {
      if (item.kind === 'drive#folder') {
        try {
          const detailData = await fetchPikPakShareData(shareId, passCode, item.id, undefined, signal);
          if (detailData.files && Array.isArray(detailData.files)) {
            allFiles.push(...detailData.files.filter((f: PikPakFileItem) => f.kind !== 'drive#folder'));
          }
        } catch {
          // continue with available files
        }
      } else {
        allFiles.push(item);
      }
    }

    if (allFiles.length === 0 && rawFiles.length > 0) {
      allFiles.push(...rawFiles);
    }

    if (allFiles.length === 0) {
      throw new Error('No files found in PikPak share');
    }

    // For any file missing web_content_link, retrieve file_info
    const formats: StreamQualityFormat[] = [];
    const validDirectUrls: string[] = [];

    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      let directUrl = file.web_content_link || file.links?.download?.url || file.medias?.[0]?.link?.url || '';

      if (!directUrl && file.id) {
        try {
          const infoData = await fetchPikPakShareData(shareId, passCode, undefined, file.id, signal);
          const fi = (infoData as any).file_info || infoData;
          directUrl = fi.web_content_link || fi.links?.download?.url || fi.medias?.[0]?.link?.url || '';
          if (fi.thumbnail_link && !file.thumbnail_link) {
            file.thumbnail_link = fi.thumbnail_link;
          }
        } catch {
          // fallback
        }
      }

      if (!directUrl) {
        directUrl = url.trim();
      } else {
        validDirectUrls.push(directUrl);
      }

      const rawExt = file.file_extension || file.name.split('.').pop() || 'bin';
      const cleanExt = rawExt.toLowerCase().replace(/^\./, '');
      const mime = (file.mime_type || '').toLowerCase();
      const isVideo =
        mime.startsWith('video/') ||
        ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'm4v', 'ts'].includes(cleanExt);
      const isAudio =
        mime.startsWith('audio/') ||
        ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'aac', 'opus', 'wma'].includes(cleanExt);
      const isImage =
        mime.startsWith('image/') ||
        ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(cleanExt);

      const sizeNum = typeof file.size === 'number' ? file.size : parseInt(String(file.size || '0'), 10);

      formats.push({
        id: `pikpak_file_${i}_${file.id || i}`,
        label: file.name || `PikPak File ${i + 1}`,
        customTitle: file.name,
        customFilename: file.name,
        qualityTier: 'original',
        ext: cleanExt,
        filesizeBytes: !isNaN(sizeNum) && sizeNum > 0 ? sizeNum : undefined,
        directUrl,
        isVideo,
        isAudio,
        isImage,
        badge: isVideo ? 'PIKPAK VIDEO' : isAudio ? 'PIKPAK AUDIO' : isImage ? 'PIKPAK IMAGE' : 'PIKPAK DIRECT',
      });
    }

    // If multiple files exist, add a master batch download option at index 0
    if (allFiles.length > 1 && validDirectUrls.length > 1) {
      const totalBytes = formats.reduce((acc, f) => acc + (f.filesizeBytes || 0), 0);
      formats.unshift({
        id: 'pikpak_all_files_pack',
        label: `All Files (${allFiles.length} items)`,
        qualityTier: 'original',
        ext: 'zip',
        filesizeBytes: totalBytes > 0 ? totalBytes : undefined,
        directUrl: validDirectUrls[0],
        isAlbumPack: true,
        allAlbumUrls: validDirectUrls,
        badge: 'ALL FILES BATCH',
      });
    }

    const firstValid = formats.find((f) => !f.isAlbumPack) || formats[0];
    const mainTitle = shareData.title || firstValid.customTitle || 'PikPak Shared Media';
    const mainThumb =
      shareData.thumbnail_link ||
      allFiles.find((f) => f.thumbnail_link)?.thumbnail_link ||
      shareData.user_info?.avatar ||
      undefined;

    return {
      url: url.trim(),
      platform: 'pikpak',
      platformName: 'PikPak Cloud',
      title: mainTitle,
      author: shareData.user_info?.nickname || undefined,
      authorAvatar: shareData.user_info?.avatar || undefined,
      thumbnailUrl: mainThumb,
      formats,
      selectedFormatId: formats[0].id,
      isDirectFile: true,
      totalItems: allFiles.length,
      resolvedAt: Date.now(),
    };
  },
};
