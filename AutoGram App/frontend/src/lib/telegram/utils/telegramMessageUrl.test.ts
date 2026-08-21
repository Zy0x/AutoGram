import { describe, expect, it } from 'vitest';
import {
  buildTelegramMessageUrl,
  extractTelegramMessageUrls,
  isTelegramActionLink,
} from './telegramMessageUrl';

describe('buildTelegramMessageUrl', () => {
  it('1. Public channel with username', () => {
    const url = buildTelegramMessageUrl({
      id: 41178,
      peer_id: '-1001234567890',
      peer_kind: 'channel',
      peer_username: 'my_public_channel',
    });
    expect(url).toBe('https://t.me/my_public_channel/41178');
  });

  it('2. Public supergroup with username', () => {
    const url = buildTelegramMessageUrl({
      id: 41178,
      peer_id: '-1001234567890',
      peer_kind: 'supergroup',
      peer_username: 'my_supergroup',
    });
    expect(url).toBe('https://t.me/my_supergroup/41178');
  });

  it('3. Private channel (-1001234567890 -> 1234567890)', () => {
    const url = buildTelegramMessageUrl({
      id: 41178,
      peer_id: '-1001234567890',
      peer_kind: 'channel',
    });
    expect(url).toBe('https://t.me/c/1234567890/41178');
  });

  it('4. Private supergroup without username', () => {
    const url = buildTelegramMessageUrl({
      id: 41178,
      peer_id: '-1004468191168',
      peer_kind: 'supergroup',
    });
    expect(url).toBe('https://t.me/c/4468191168/41178');
  });

  it('5. Forum topic public', () => {
    const url = buildTelegramMessageUrl({
      id: 41178,
      peer_id: '-1001234567890',
      peer_kind: 'supergroup',
      peer_username: 'forum_group',
      topic_id: 73,
    });
    expect(url).toBe('https://t.me/forum_group/73/41178');
  });

  it('6. Forum topic private', () => {
    const url = buildTelegramMessageUrl({
      id: 41178,
      peer_id: '-1001234567890',
      peer_kind: 'supergroup',
      topic_id: 73,
    });
    expect(url).toBe('https://t.me/c/1234567890/73/41178');
  });

  it('7. Grouped media album with ?single', () => {
    const url = buildTelegramMessageUrl({
      id: 41178,
      peer_id: '-1001234567890',
      peer_kind: 'supergroup',
      topic_id: 1234,
      grouped_id: '9988776655',
    });
    expect(url).toBe('https://t.me/c/1234567890/1234/41178?single');
  });

  it('8. Saved Messages returns null', () => {
    const url = buildTelegramMessageUrl({
      id: 41178,
      peer_id: 'me',
      is_saved_messages: true,
      peer_kind: 'saved_messages',
    });
    expect(url).toBeNull();
  });

  it('9. Private user chat returns null', () => {
    const url = buildTelegramMessageUrl({
      id: 41178,
      peer_id: '987654321',
      peer_kind: 'user',
    });
    expect(url).toBeNull();
  });

  it('10. Invalid peer_id returns null', () => {
    const url = buildTelegramMessageUrl({
      id: 41178,
      peer_id: 'invalid_peer_abc',
      peer_kind: 'unknown',
    });
    expect(url).toBeNull();
  });

  it('11. File from old location after location switch uses own file peer identity', () => {
    const oldFile = {
      id: 41178,
      peer_id: '-1001234567890', // file belongs to channel A
      peer_kind: 'channel',
      peer_username: 'channel_a',
    };
    // Active location might be channel B ('-1009999999999'), but helper MUST use file's own identity!
    const url = buildTelegramMessageUrl(oldFile);
    expect(url).toBe('https://t.me/channel_a/41178');
  });

  it('12. Two peers with same message_id generate distinct URLs', () => {
    const file1 = {
      id: 41178,
      peer_id: '-1001111111111',
      peer_kind: 'channel',
    };
    const file2 = {
      id: 41178,
      peer_id: '-1002222222222',
      peer_kind: 'channel',
    };
    expect(buildTelegramMessageUrl(file1)).toBe('https://t.me/c/1111111111/41178');
    expect(buildTelegramMessageUrl(file2)).toBe('https://t.me/c/2222222222/41178');
  });
});

describe('Telegram message link extraction', () => {
  it('extracts all unique links and trims surrounding punctuation', () => {
    expect(extractTelegramMessageUrls(
      'One https://example.com/a, two https://example.com/b. duplicate https://example.com/a'
    )).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('keeps Telegram bot/deep links as explicit Telegram actions', () => {
    expect(isTelegramActionLink('https://t.me/example_bot?start=abc')).toBe(true);
    expect(isTelegramActionLink('tg://resolve?domain=example_bot')).toBe(true);
    expect(isTelegramActionLink('https://pixeldrain.com/u/abc')).toBe(false);
  });
});
