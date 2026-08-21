import type { DriveFile } from '../driveTypes';

const MESSAGE_URL_RE = /(?:https?:\/\/|tg:\/\/)[^\s<>"'`]+/giu;

export function extractTelegramMessageUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of text.match(MESSAGE_URL_RE) || []) {
    const value = match.replace(/[),.;!?]+$/u, '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
  }
  return urls;
}

export function isTelegramActionLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'tg:' || /(^|\.)t\.me$/i.test(parsed.hostname);
  } catch {
    return url.startsWith('tg://');
  }
}

export interface TelegramUrlInput {
  id?: number | null;
  messageId?: number | null;
  peer_id?: string | null;
  peerId?: string | null;
  peer_kind?: string | null;
  peerKind?: string | null;
  peer_username?: string | null;
  peerUsername?: string | null;
  username?: string | null;
  topic_id?: number | null;
  topicId?: number | null;
  grouped_id?: number | string | null;
  groupedId?: number | string | null;
  is_saved_messages?: boolean | null;
  isSavedMessages?: boolean | null;
}

/**
 * Builds canonical Telegram web message link (https://t.me/...).
 * Supported formats:
 * - Public Channel/Supergroup: https://t.me/<username>/[<topic_id>/]<message_id>[?single]
 * - Private Channel/Supergroup (-100... -> channel_id): https://t.me/c/<channel_id>/[<topic_id>/]<message_id>[?single]
 * - Grouped album media: appends ?single
 *
 * Returns null if link cannot be constructed (Saved Messages, User chats, Basic groups, invalid IDs).
 */
export function buildTelegramMessageUrl(file: TelegramUrlInput | DriveFile | null | undefined): string | null {
  if (!file) return null;
  const f = file as any;

  // 1. Resolve messageId
  const messageId = f.id ?? f.messageId;
  if (!messageId || messageId <= 0 || !Number.isFinite(messageId)) return null;

  // 2. Resolve isSavedMessages / Saved Messages
  const isSavedMessages = f.is_saved_messages ?? f.isSavedMessages ?? false;
  const rawPeerId = (f.peer_id ?? f.peerId ?? '').trim();
  if (isSavedMessages || rawPeerId === 'me' || rawPeerId === '0') return null;

  // 3. Resolve peerKind
  const peerKind = (f.peer_kind ?? f.peerKind ?? '').toLowerCase();
  if (peerKind === 'saved_messages' || peerKind === 'user' || peerKind === 'basic_group') {
    return null;
  }

  // 4. Resolve username
  const rawUsername = (f.peer_username ?? f.peerUsername ?? f.username ?? '').trim().replace(/^@/, '');

  // 5. Resolve topicId
  const topicId = f.topic_id ?? f.topicId;
  const hasTopic = topicId != null && topicId > 0 && Number.isFinite(topicId);

  // 6. Resolve groupedId / album
  const rawGroupedId = f.grouped_id ?? f.groupedId;
  const isGrouped = rawGroupedId != null && rawGroupedId !== 0 && rawGroupedId !== '0';

  // 7. Case A: Public channel or supergroup with valid username
  if (rawUsername && /^[a-zA-Z0-9_]{4,32}$/.test(rawUsername)) {
    let url = `https://t.me/${rawUsername}/`;
    if (hasTopic) {
      url += `${topicId}/`;
    }
    url += `${messageId}`;
    if (isGrouped) {
      url += '?single';
    }
    return url;
  }

  // 8. Case B: Channel or supergroup without username (Private link t.me/c/<channel_id>/...)
  let channelId = '';
  if (rawPeerId.startsWith('-100')) {
    channelId = rawPeerId.slice(4);
  } else if (/^\d+$/.test(rawPeerId)) {
    channelId = rawPeerId;
  } else if (rawPeerId.startsWith('-')) {
    channelId = rawPeerId.slice(1);
  }

  if (channelId && /^\d+$/.test(channelId)) {
    let url = `https://t.me/c/${channelId}/`;
    if (hasTopic) {
      url += `${topicId}/`;
    }
    url += `${messageId}`;
    if (isGrouped) {
      url += '?single';
    }
    return url;
  }

  // 9. If peerKind explicitly says channel or supergroup but channelId couldn't be parsed:
  if (peerKind === 'channel' || peerKind === 'supergroup') {
    // If peerId was missing but username existed, handled above.
    return null;
  }

  return null;
}
