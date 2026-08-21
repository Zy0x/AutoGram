import { describe, expect, it } from 'vitest';

import { mapDialogToChat, resolveRestrictionReasonKey } from '../../../lib/telegram/driveApi/driveApiUtils';

describe('mapDialogToChat', () => {
  it('keeps bots separate from private chats', () => {
    expect(
      mapDialogToChat({ id: 1, title: 'Helper Bot', isUser: true, isBot: true }).type,
    ).toBe('bot');
    expect(
      mapDialogToChat({ id: 2, title: 'Private Chat', isUser: true, isBot: false }).type,
    ).toBe('user');
  });

  it('separates forum groups from broadcast channels', () => {
    const forum = mapDialogToChat({
      id: -1001,
      title: 'Forum',
      isChannel: true,
      isGroup: true,
      isForum: true,
    });
    const channel = mapDialogToChat({
      id: -1002,
      title: 'Channel',
      isChannel: true,
      isGroup: false,
      isForum: false,
    });

    expect(forum).toMatchObject({ type: 'group', is_forum: true });
    expect(channel).toMatchObject({ type: 'channel', is_forum: false });
  });

  it('preserves Telegram restriction metadata for the active account', () => {
    expect(mapDialogToChat({
      id: -1003606461240,
      title: 'Restricted channel',
      isChannel: true,
      isRestricted: true,
      restrictionReason: "This channel can't be displayed because it was used to spread pornographic content.",
      restrictionCode: 'porn',
    })).toMatchObject({
      is_restricted: true,
      restriction_code: 'porn',
      restriction_reason: "This channel can't be displayed because it was used to spread pornographic content.",
    });
  });
});

describe('resolveRestrictionReasonKey', () => {
  it('resolves sensitive and pornographic restriction codes correctly', () => {
    expect(resolveRestrictionReasonKey('sensitive', null)).toBe('sensitive');
    expect(resolveRestrictionReasonKey('all:sensitive', null)).toBe('sensitive');
    expect(resolveRestrictionReasonKey('porn', null)).toBe('sensitive');
    expect(resolveRestrictionReasonKey(null, 'contains sensitive content')).toBe('sensitive');
    expect(resolveRestrictionReasonKey(null, 'spread pornographic content')).toBe('sensitive');
  });

  it('resolves copyright, violence, and spam codes', () => {
    expect(resolveRestrictionReasonKey('copyright', null)).toBe('copyright');
    expect(resolveRestrictionReasonKey('dmca', null)).toBe('copyright');
    expect(resolveRestrictionReasonKey('violence', null)).toBe('violence');
    expect(resolveRestrictionReasonKey('spam', null)).toBe('spam');
    expect(resolveRestrictionReasonKey('scam', null)).toBe('spam');
  });

  it('falls back to restricted for generic or missing reasons', () => {
    expect(resolveRestrictionReasonKey(null, null)).toBe('restricted');
    expect(resolveRestrictionReasonKey('other', 'access restricted')).toBe('restricted');
  });
});
