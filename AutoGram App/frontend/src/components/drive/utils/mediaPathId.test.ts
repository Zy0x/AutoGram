import { describe, expect, it } from 'vitest';
import { buildMediaPathId, mediaPeerPrefix } from './mediaPathId';

describe('media Path ID', () => {
  it('builds a non-forum group path with only the media ID at the tail', () => {
    expect(buildMediaPathId({
      accountUserId: 8420671507,
      locationKind: 'chat',
      peerId: -1003905658859,
      mediaId: 5,
      chat: { type: 'group', is_forum: false },
    })).toBe('U8420671507/G-1003905658859/5');
  });

  it('includes a typed topic segment for forums', () => {
    expect(buildMediaPathId({
      accountUserId: 8420671507,
      locationKind: 'chat',
      peerId: -1003214112048,
      topicId: 9929,
      mediaId: 43257,
      chat: { type: 'group', is_forum: true },
    })).toBe('U8420671507/G-1003214112048/T9929/43257');
  });

  it('uses distinct drive, channel, bot, chat, and saved prefixes', () => {
    expect(mediaPeerPrefix({ accountUserId: 1, locationKind: 'drive', peerId: 2 })).toBe('D');
    expect(mediaPeerPrefix({ accountUserId: 1, locationKind: 'chat', peerId: 2, chat: { type: 'channel' } })).toBe('CH');
    expect(mediaPeerPrefix({ accountUserId: 1, locationKind: 'chat', peerId: 2, chat: { type: 'bot' } })).toBe('B');
    expect(mediaPeerPrefix({ accountUserId: 1, locationKind: 'chat', peerId: 2, chat: { type: 'user' } })).toBe('C');
    expect(mediaPeerPrefix({ accountUserId: 1, locationKind: 'saved', peerId: null })).toBe('SM');
  });
});
