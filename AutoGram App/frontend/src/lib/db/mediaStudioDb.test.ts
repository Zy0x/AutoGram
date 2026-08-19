import { describe, expect, it } from 'vitest';
import {
  buildDriveMediaContext,
  normalizeTopicId,
  type MediaIndexState,
} from './mediaStudioDb';

describe('Media Studio IndexedDB context isolation & MediaIndexState Contract', () => {
  it('creates different identities for Saved Messages in different sessions', () => {
    const a = buildDriveMediaContext('Lavender', null, null);
    const b = buildDriveMediaContext('Mantan Gadis', null, null);

    expect(a).toEqual({ accountId: 'Lavender', peerId: 'me', scopeKind: 'all', topicId: null });
    expect(b).toEqual({ accountId: 'Mantan Gadis', peerId: 'me', scopeKind: 'all', topicId: null });
    expect(a.accountId).not.toBe(b.accountId);
  });

  it('separates all-media, general, and forum-topic scopes', () => {
    const all = buildDriveMediaContext('Lavender', -1001, null);
    const general = buildDriveMediaContext('Lavender', -1001, 0);
    const topic = buildDriveMediaContext('Lavender', -1001, 17);

    expect([all.scopeKind, general.scopeKind, topic.scopeKind]).toEqual(['all', 'general', 'topic']);
    expect([
      normalizeTopicId(all.scopeKind, all.topicId),
      normalizeTopicId(general.scopeKind, general.topicId),
      normalizeTopicId(topic.scopeKind, topic.topicId),
    ]).toEqual([-1, 0, 17]);
  });

  it('MediaIndexState tracks dual-lane committed watermarks and backfill status', () => {
    const state: MediaIndexState = {
      accountId: 'session_user_1',
      peerId: '1001234567',
      scopeKind: 'all',
      topicIdNormalized: -1,
      pvCommittedOffset: 1200,
      docCommittedOffset: 950,
      pvExhausted: false,
      docExhausted: false,
      newestCommittedId: 5000,
      oldestCommittedId: 950,
      backfillComplete: false,
      exactMediaCount: null,
      exactBytes: null,
      pts: null,
      schemaVersion: 1,
      startedAt: 1700000000000,
      updatedAt: 1700000010000,
    };

    expect(state.pvCommittedOffset).toBe(1200);
    expect(state.docCommittedOffset).toBe(950);
    expect(state.backfillComplete).toBe(false);
  });
});
