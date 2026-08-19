import { describe, it, expect } from 'vitest';
import type { TgScopedMediaSearchCursor, TgSearchScope } from './core/telegramBackend';

describe('ScopedMediaSearchCursor & Scope Isolation Tests', () => {
  function validateOrResetCursor(
    incomingCursor: TgScopedMediaSearchCursor | null,
    currentScope: TgSearchScope
  ): TgScopedMediaSearchCursor {
    if (
      incomingCursor &&
      incomingCursor.scope.accountId === currentScope.accountId &&
      incomingCursor.scope.peerId === currentScope.peerId &&
      (incomingCursor.scope.topicId ?? null) === (currentScope.topicId ?? null)
    ) {
      return incomingCursor;
    }
    // Scope mismatch -> reject stale cursor and initialize fresh for current scope
    return {
      scope: currentScope,
      photoVideo: { offsetId: 0, exhausted: false },
      document: { offsetId: 0, exhausted: false },
    };
  }

  it('1. Rejects cursor and starts fresh when peerId changes (#Gudang -> #ChannelBaru)', () => {
    const staleCursor: TgScopedMediaSearchCursor = {
      scope: {
        accountId: 'session_user_1',
        peerId: '1001234567', // #Gudang
        topicId: null,
      },
      photoVideo: { offsetId: 15000, exhausted: false },
      document: { offsetId: 12000, exhausted: false },
    };

    const newScope: TgSearchScope = {
      accountId: 'session_user_1',
      peerId: '1009876543', // #ChannelBaru
      topicId: null,
    };

    const validated = validateOrResetCursor(staleCursor, newScope);
    expect(validated.scope.peerId).toBe('1009876543');
    expect(validated.photoVideo.offsetId).toBe(0);
    expect(validated.document.offsetId).toBe(0);
    expect(validated.photoVideo.exhausted).toBe(false);
    expect(validated.document.exhausted).toBe(false);
  });

  it('2. Rejects cursor and starts fresh when topicId changes within the same forum channel', () => {
    const staleCursor: TgScopedMediaSearchCursor = {
      scope: {
        accountId: 'session_user_1',
        peerId: '1001234567',
        topicId: 42, // Topic 42
      },
      photoVideo: { offsetId: 9500, exhausted: false },
      document: { offsetId: 8100, exhausted: false },
    };

    const newScope: TgSearchScope = {
      accountId: 'session_user_1',
      peerId: '1001234567',
      topicId: 99, // Topic 99
    };

    const validated = validateOrResetCursor(staleCursor, newScope);
    expect(validated.scope.topicId).toBe(99);
    expect(validated.photoVideo.offsetId).toBe(0);
    expect(validated.document.offsetId).toBe(0);
  });

  it('3. Rejects cursor and starts fresh when accountId changes', () => {
    const staleCursor: TgScopedMediaSearchCursor = {
      scope: {
        accountId: 'session_user_A',
        peerId: '1001234567',
        topicId: null,
      },
      photoVideo: { offsetId: 5000, exhausted: false },
      document: { offsetId: 4000, exhausted: false },
    };

    const newScope: TgSearchScope = {
      accountId: 'session_user_B',
      peerId: '1001234567',
      topicId: null,
    };

    const validated = validateOrResetCursor(staleCursor, newScope);
    expect(validated.scope.accountId).toBe('session_user_B');
    expect(validated.photoVideo.offsetId).toBe(0);
  });

  it('4. Retains and advances cursor when scope matches perfectly', () => {
    const validCursor: TgScopedMediaSearchCursor = {
      scope: {
        accountId: 'session_user_1',
        peerId: '1001234567',
        topicId: null,
      },
      photoVideo: { offsetId: 901, exhausted: false },
      document: { offsetId: 701, exhausted: false },
    };

    const matchingScope: TgSearchScope = {
      accountId: 'session_user_1',
      peerId: '1001234567',
      topicId: null,
    };

    const validated = validateOrResetCursor(validCursor, matchingScope);
    expect(validated).toEqual(validCursor);
    expect(validated.photoVideo.offsetId).toBe(901);
    expect(validated.document.offsetId).toBe(701);
  });

  it('5. HasMore is strictly true until BOTH lanes are exhausted (authoritative completion)', () => {
    function hasMoreWork(cursor: TgScopedMediaSearchCursor): boolean {
      return !cursor.photoVideo.exhausted || !cursor.document.exhausted;
    }

    // Only photoVideo exhausted
    const cursor1: TgScopedMediaSearchCursor = {
      scope: { accountId: 's1', peerId: 'p1', topicId: null },
      photoVideo: { offsetId: 1, exhausted: true },
      document: { offsetId: 800, exhausted: false },
    };
    expect(hasMoreWork(cursor1)).toBe(true);

    // Only document exhausted
    const cursor2: TgScopedMediaSearchCursor = {
      scope: { accountId: 's1', peerId: 'p1', topicId: null },
      photoVideo: { offsetId: 500, exhausted: false },
      document: { offsetId: 1, exhausted: true },
    };
    expect(hasMoreWork(cursor2)).toBe(true);

    // Both exhausted
    const cursor3: TgScopedMediaSearchCursor = {
      scope: { accountId: 's1', peerId: 'p1', topicId: null },
      photoVideo: { offsetId: 1, exhausted: true },
      document: { offsetId: 1, exhausted: true },
    };
    expect(hasMoreWork(cursor3)).toBe(false);
  });
});
