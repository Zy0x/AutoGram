import type { DriveChat, DriveFile } from '../../../lib/telegram/driveTypes';

export type MediaPathLocationKind = 'saved' | 'drive' | 'chat';

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

export function mediaPeerPrefix(input: MediaPathIdInput): string {
  if (input.locationKind === 'saved' || input.file?.is_saved_messages) return 'SM';
  if (input.locationKind === 'drive') return 'D';

  const peerKind = String(input.file?.peer_kind || '').toLowerCase();
  const chatType = String(input.chat?.type || '').toLowerCase();
  if (chatType === 'bot') return 'B';
  if (chatType === 'group' || peerKind === 'supergroup' || peerKind === 'basic_group') return 'G';
  if (chatType === 'channel' || peerKind === 'channel') return 'CH';
  return 'C';
}

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
