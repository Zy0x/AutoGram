export type RemoteShareInput = {
  cleanUrl: string;
  extractedPasscode?: string;
};

/**
 * Platform-neutral parser for desktop clipboard input and Android/iOS share
 * intents. It accepts surrounding prose, extracts the first HTTP(S) URL, and
 * recognizes common cloud passcode conventions without retaining the source
 * share payload.
 */
export function parseRemoteShareInput(rawText: string): RemoteShareInput {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return { cleanUrl: '' };

  const urlMatch = trimmed.match(/https?:\/\/[^\s<>"']+/iu);
  const rawUrl = (urlMatch?.[0] || trimmed.split(/\s+/u)[0] || '')
    .replace(/[),.;!?]+$/u, '');
  let extractedPasscode: string | undefined;

  try {
    const url = new URL(rawUrl);
    extractedPasscode =
      url.searchParams.get('pwd') ||
      url.searchParams.get('pass_code') ||
      url.searchParams.get('code') ||
      url.searchParams.get('passcode') ||
      undefined;
    if (!extractedPasscode && url.hash) {
      const hash = url.hash.replace(/^#/u, '').trim();
      if (/^[\p{L}\p{N}_-]{4,32}$/u.test(hash)) extractedPasscode = hash;
    }
  } catch {
    return { cleanUrl: rawUrl };
  }

  if (!extractedPasscode) {
    const label = trimmed.match(
      /(?:pwd|pw|pass(?:word)?|pasword|passcode|code|kode|sandi|提取码|密码)\s*(?:is|adalah|[:=：-])?\s*[`'"]?([\p{L}\p{N}_@#$%+.-]{2,64})/iu
    );
    extractedPasscode = label?.[1]?.trim();
  }

  return { cleanUrl: rawUrl, extractedPasscode };
}
