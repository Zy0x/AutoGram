import type { DriveChat, DriveFile } from '../../../lib/telegram/driveTypes';

export type MediaPathLocationKind = 'saved' | 'drive' | 'chat';

export type MediaPeerPrefixType = 'U' | 'SM' | 'D' | 'CH' | 'G' | 'B' | 'C';

export type MediaPathIdInput = {
  accountUserId: string | number;
  locationKind: MediaPathLocationKind;
  peerId: string | number | null;
  topicId?: string | number | null;
  mediaId?: string | number | null;
  chat?: Pick<DriveChat, 'type' | 'is_forum'> | null;
  file?: Pick<DriveFile, 'peer_kind' | 'is_saved_messages'> | null;
};

function cleanNumericId(value: string | number | null | undefined): string {
  const raw = String(value ?? '').trim();
  return raw || '0';
}

/**
 * Standard AutoGram Telegram Path ID Peer Prefixes:
 * - SM : Saved Messages (self / cloud scratchpad)
 * - D  : Drive Folder / Virtual Folder
 * - CH : Broadcast Channel
 * - G  : Supergroup / Basic Group / Forum
 * - B  : Bot Chat
 * - C  : Direct User Conversation / Private Chat
 */
export function mediaPeerPrefix(input: MediaPathIdInput): MediaPeerPrefixType {
  if (input.locationKind === 'saved' || input.file?.is_saved_messages || input.file?.peer_kind === 'saved_messages') {
    return 'SM';
  }
  if (input.locationKind === 'drive') {
    return 'D';
  }

  const peerKind = String(input.file?.peer_kind || '').toLowerCase();
  const chatType = String(input.chat?.type || '').toLowerCase();

  if (chatType === 'bot' || peerKind === 'bot') return 'B';
  if (chatType === 'group' || peerKind === 'supergroup' || peerKind === 'basic_group') return 'G';
  if (chatType === 'channel' || peerKind === 'channel') return 'CH';
  if (chatType === 'user' || peerKind === 'user') return 'C';

  return 'C';
}

/**
 * Standard AutoGram Path ID Builder:
 * Segment 1: U<accountUserId>
 * Segment 2: <PeerPrefix><peerId> or 'SM'
 * Segment 3: T<topicId> (if forum topic > 0)
 * Segment 4: <mediaId> (if media message ID present)
 *
 * Examples:
 * - U8420671507/SM
 * - U8420671507/SM/43257
 * - U8420671507/D-1003214112048
 * - U8420671507/G-1003214112048/T9929/43257
 * - U8420671507/CH-1002557538013/63280
 * - U8420671507/B1825028508/100
 * - U8420671507/C123456789/50
 */
export function buildMediaPathId(input: MediaPathIdInput): string {
  const account = `U${cleanNumericId(input.accountUserId)}`;
  const prefix = mediaPeerPrefix(input);
  const location = prefix === 'SM' ? prefix : `${prefix}${cleanNumericId(input.peerId)}`;
  const segments = [account, location];
  const topicId = Number(input.topicId || 0);
  if (Number.isFinite(topicId) && topicId > 0) segments.push(`T${topicId}`);
  if (input.mediaId != null && String(input.mediaId).trim()) {
    segments.push(cleanNumericId(input.mediaId));
  }
  return segments.join('/');
}
