/**
 * pathSearchParser.ts
 *
 * Precise parser for AutoGram sidebar Path ID search.
 * Supports all Telegram location address formats:
 *
 * Full:    U8542241823/D-1003214112048/T8/20213
 * Partial: D-1003214112048/T8, D-1003214112048/20213, U.../D...
 * tme:     https://t.me/c/1003214112048/8/20213  (channel: topic: msg)
 *          https://t.me/username/20213            (public: msg)
 * Raw ID:  -1003214112048  (peer only)
 * Username: @username
 */

/** Recognised segment prefixes */
const PREFIX_ACCOUNT = /^[Uu]$/;
const PREFIX_DRIVE = /^(?:[DdCcGgBb]|[Cc][Hh])$/;
const PREFIX_TOPIC = /^[Tt]$/;
const PREFIX_MEDIA = /^[Mm]$/;

/** Parsed Telegram path result */
export type ParsedTelegramPath = {
  raw: string;
  isPathId: boolean;
  accountSegment: string | null;
  chatId: number | null;
  chatSegmentRaw: string | null;
  topicId: number | null;
  messageId: number | null;
  tmeUsername: string | null;
  confidence: 'full' | 'partial' | 'fallback';
};

function normalizePrefixedPeerId(prefix: string, raw: string): number | null {
  // Telegram users and bots keep their positive user id. Supergroups/channels
  // use the canonical -100... peer id. This distinction is critical for Path
  // IDs because a bot id can be numerically large enough to look like a
  // channel id to the generic bare-number normalizer.
  if (/^[BbCc]$/.test(prefix)) {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.abs(n) : null;
  }
  return normalizePeerId(raw);
}

const EMPTY_PATH: ParsedTelegramPath = {
  raw: '',
  isPathId: false,
  accountSegment: null,
  chatId: null,
  chatSegmentRaw: null,
  topicId: null,
  messageId: null,
  tmeUsername: null,
  confidence: 'fallback',
};

export function normalizePeerId(raw: string): number | null {
  const stripped = raw.trim();
  if (!stripped) return null;
  const n = Number(stripped);
  if (isNaN(n) || !isFinite(n)) return null;
  if (n < 0) return n;
  if (n > 999_999_999) return -(1_000_000_000_000 + n);
  return n;
}

const TME_CHANNEL_RE = /(?:https?:\/\/)?t\.me\/c\/(\d+)(?:\/(\d+))?(?:\/(\d+))?/i;
const TME_PUBLIC_RE = /(?:https?:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})(?:\/(\d+))?(?:\/(\d+))?/i;

function parseTmeUrl(input: string): ParsedTelegramPath | null {
  const channelMatch = TME_CHANNEL_RE.exec(input);
  if (channelMatch) {
    const chatId = normalizePeerId(channelMatch[1]);
    const second = channelMatch[2] ? Number(channelMatch[2]) : null;
    const third = channelMatch[3] ? Number(channelMatch[3]) : null;
    const topicId = third !== null ? second : null;
    const messageId = third !== null ? third : second;
    return {
      raw: input, isPathId: true, accountSegment: null,
      chatId, chatSegmentRaw: channelMatch[1],
      topicId, messageId, tmeUsername: null, confidence: 'full',
    };
  }
  const publicMatch = TME_PUBLIC_RE.exec(input);
  if (publicMatch) {
    const username = publicMatch[1].toLowerCase();
    const second = publicMatch[2] ? Number(publicMatch[2]) : null;
    const third = publicMatch[3] ? Number(publicMatch[3]) : null;
    const topicId = third !== null ? second : null;
    const messageId = third !== null ? third : second;
    return {
      raw: input, isPathId: true, accountSegment: null,
      chatId: null, chatSegmentRaw: null,
      topicId, messageId, tmeUsername: username, confidence: 'partial',
    };
  }
  return null;
}

function parseSegments(input: string): ParsedTelegramPath | null {
  const parts = input.trim().split(/[\/\s]+/).filter(Boolean);
  if (parts.length === 0) return null;

  let accountSegment: string | null = null;
  let chatId: number | null = null;
  let chatSegmentRaw: string | null = null;
  let topicId: number | null = null;
  let messageId: number | null = null;
  let hitCount = 0;

  for (const part of parts) {
    const prefixMatch = /^(CH|ch|Ch|cH|[UuDdCcGgBbTtMm#])(-?\d+)$/.exec(part);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      const valueStr = prefixMatch[2];
      if (PREFIX_ACCOUNT.test(prefix)) { accountSegment = valueStr; hitCount++; continue; }
      if (PREFIX_DRIVE.test(prefix)) { chatId = normalizePrefixedPeerId(prefix, valueStr); chatSegmentRaw = valueStr; hitCount++; continue; }
      if (PREFIX_TOPIC.test(prefix)) { topicId = Number(valueStr); hitCount++; continue; }
      if (PREFIX_MEDIA.test(prefix) || prefix === '#') { messageId = Number(valueStr); hitCount++; continue; }
    }

    const pureNumMatch = /^(-?\d+)$/.exec(part);
    if (pureNumMatch) {
      const num = Number(pureNumMatch[1]);
      // If single standalone bare number without prefix, require >= 5 digits or negative peer ID
      if (parts.length === 1 && !/^-?\d{5,}$/.test(part) && num >= 0) {
        continue;
      }
      if (chatId === null && chatSegmentRaw === null) {
        chatId = normalizePeerId(pureNumMatch[1]); chatSegmentRaw = pureNumMatch[1];
      } else if (messageId === null) { messageId = num; }
      hitCount++; continue;
    }

    const usernameMatch = /^@([A-Za-z][A-Za-z0-9_]{3,31})$/.exec(part);
    if (usernameMatch) {
      if (chatId === null && chatSegmentRaw === null) chatSegmentRaw = usernameMatch[1];
      else if (!accountSegment) accountSegment = usernameMatch[1];
      hitCount++; continue;
    }

    const bareUsernameMatch = /^([A-Za-z][A-Za-z0-9_]{3,31})$/.exec(part);
    if (bareUsernameMatch && hitCount > 0) {
      if (chatId === null && chatSegmentRaw === null) { chatSegmentRaw = bareUsernameMatch[1]; hitCount++; }
      continue;
    }
  }

  if (hitCount === 0) return null;
  const hasChatTarget = chatId !== null || chatSegmentRaw !== null;
  const isPathId = hasChatTarget || accountSegment !== null;
  const confidence: 'full' | 'partial' | 'fallback' =
    hitCount >= 2 ? 'full' : isPathId ? 'partial' : 'fallback';

  return { raw: input, isPathId, accountSegment, chatId, chatSegmentRaw, topicId, messageId, tmeUsername: null, confidence };
}

export function parseTelegramPathId(query: string): ParsedTelegramPath {
  const trimmed = (query || '').trim();
  if (!trimmed) return { ...EMPTY_PATH, raw: trimmed };

  if (/t\.me\//i.test(trimmed)) {
    const tme = parseTmeUrl(trimmed);
    if (tme) return tme;
  }

  const seg = parseSegments(trimmed);
  if (seg && seg.isPathId) return seg;

  const userMatch = /^@([A-Za-z][A-Za-z0-9_]{3,31})$/.exec(trimmed);
  if (userMatch) {
    return {
      raw: trimmed, isPathId: true, accountSegment: null,
      chatId: null, chatSegmentRaw: userMatch[1],
      topicId: null, messageId: null, tmeUsername: null, confidence: 'partial',
    };
  }

  const numMatch = /^-?\d{5,}$/.exec(trimmed);
  if (numMatch) {
    return {
      raw: trimmed, isPathId: true, accountSegment: null,
      chatId: normalizePeerId(trimmed), chatSegmentRaw: trimmed,
      topicId: null, messageId: null, tmeUsername: null, confidence: 'partial',
    };
  }

  return { ...EMPTY_PATH, raw: trimmed, isPathId: false };
}

export function describePath(
  p: ParsedTelegramPath,
  t: (key: string, opts?: any) => string,
  resolved?: {
    accountName?: string | null;
    chatName?: string | null;
    topicName?: string | null;
    mediaName?: string | null;
  }
): string {
  const parts: string[] = [];
  const acc = resolved?.accountName || (p.accountSegment ? `U${p.accountSegment}` : null);
  if (acc) parts.push(`${t('ui.path_jump.account')}: ${acc}`);

  const loc =
    resolved?.chatName ||
    (p.tmeUsername ? `@${p.tmeUsername}` : p.chatSegmentRaw ? `D${p.chatSegmentRaw}` : null);
  if (loc) parts.push(`${t('ui.path_jump.location')}: ${loc}`);

  const top = resolved?.topicName || (p.topicId !== null ? `T${p.topicId}` : null);
  if (top) parts.push(`${t('ui.path_jump.topic')}: ${top}`);

  const med = resolved?.mediaName || (p.messageId !== null ? `#${p.messageId}` : null);
  if (med) parts.push(`${t('ui.path_jump.media')}: ${med}`);

  return parts.join(' › ');
}
