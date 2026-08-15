/**
 * Canonical Media Identity Contract for AutoGram
 * Strictly prevents peer identity bleed (e.g. defaulting #Gudang to 'me').
 */

export interface MediaIdentity {
  accountId: string;
  peerId: string;
  topicId: number | null;
  messageId: number;
}

export type LocationType = 'saved_messages' | 'group' | 'channel' | 'supergroup' | 'chat' | 'folder' | 'search';

/**
 * Validates that peerId === 'me' is ONLY allowed for saved_messages.
 * Throws or returns an error string if 'me' is used for non-saved_messages locations.
 */
export function validateMediaIdentity(
  identity: Partial<MediaIdentity>,
  locationType?: string
): { valid: boolean; error?: string } {
  const peer = (identity.peerId || '').trim();
  const msgId = identity.messageId || 0;

  if (!peer) {
    return { valid: false, error: 'MISSING_PEER_ID: peerId is empty or undefined' };
  }
  if (msgId <= 0) {
    return { valid: false, error: 'INVALID_MESSAGE_ID: messageId must be > 0' };
  }

  // Strict rule: 'me' is strictly inputPeerSelf (Saved Messages).
  // If location is specified and not saved_messages, 'me' is strictly forbidden.
  if (peer === 'me' && locationType && locationType !== 'saved_messages') {
    return {
      valid: false,
      error: `INVALID_SELF_PEER_USAGE: peerId 'me' cannot be used for locationType '${locationType}'`,
    };
  }

  return { valid: true };
}

/**
 * Builds canonical request ID for thumbnail batching:
 * thumb:<account_id>:<peer_id>:<topic_id>:<message_id>:g<generation>
 */
export function buildCanonicalThumbRequestId(
  identity: MediaIdentity,
  generation: number
): string {
  const acc = identity.accountId || 'default';
  const peer = identity.peerId || 'unknown';
  const topic = identity.topicId != null ? identity.topicId : 'none';
  const msg = identity.messageId;
  return `thumb:${acc}:${peer}:${topic}:${msg}:g${generation}`;
}

/**
 * Builds canonical cache key for IndexedDB, SQLite, and previewCache:
 * <account_id>:<peer_id>:<topic_id>:<message_id>:<quality_or_kind>
 */
export function buildCanonicalCacheKey(
  identity: MediaIdentity,
  variant = 'auto'
): string {
  const acc = identity.accountId || 'default';
  const peer = identity.peerId || 'unknown';
  const topic = identity.topicId != null ? identity.topicId : 'root';
  const msg = identity.messageId;
  return `${acc}:${peer}:${topic}:${msg}:${variant}`;
}
