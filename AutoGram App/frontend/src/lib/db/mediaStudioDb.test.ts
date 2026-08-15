import { describe, expect, it } from 'vitest';
import { buildDriveMediaContext, normalizeTopicId } from './mediaStudioDb';

describe('Media Studio IndexedDB context isolation', () => {
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
});
