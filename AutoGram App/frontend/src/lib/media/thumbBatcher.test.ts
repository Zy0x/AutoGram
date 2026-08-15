import { describe, expect, it } from 'vitest';
import { buildThumbCacheKey, buildThumbItemRequest } from './thumbBatcher';

describe('thumbnail locator correlation', () => {
  it('preserves the exact peer and message identity required by Rust', () => {
    const request = buildThumbItemRequest('Lavender', '-1004468191168', 17, 72, 4, 'balanced');
    expect(request).toEqual({
      requestId: 'thumb:Lavender:-1004468191168:17:72:g4',
      peerId: '-1004468191168',
      telegramMessageId: 72,
      quality: 'balanced',
      generation: 4,
    });
  });

  it('isolates identical message ids by account, peer, and topic', () => {
    const savedA = buildThumbCacheKey(null, 72, 'balanced', 'Lavender', 'me', null);
    const savedB = buildThumbCacheKey(null, 72, 'balanced', 'Mantan Gadis', 'me', null);
    const groupA = buildThumbCacheKey(-1001, 72, 'balanced', 'Lavender', '-1001', null);
    const topicA = buildThumbCacheKey(-1001, 72, 'balanced', 'Lavender', '-1001', 17);

    expect(new Set([savedA, savedB, groupA, topicA]).size).toBe(4);
    expect(savedA).toBe('v2:Lavender:balanced:me:none:72');
  });
});
