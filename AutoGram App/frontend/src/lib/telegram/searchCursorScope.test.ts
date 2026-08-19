import { describe, it, expect } from 'vitest';
import type { TgScopedMediaSearchCursor, TgSearchScope } from './core/telegramBackend';

describe('ScopedMediaSearchCursor, Watermark & Buffered Merge Contract', () => {
  function normalizeSearchCursorContract(
    incomingCursor: TgScopedMediaSearchCursor | null,
    currentScope: TgSearchScope,
    initialOffset = 0
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
      photoVideo: { fetchOffsetId: initialOffset, exhausted: false },
      document: { fetchOffsetId: initialOffset, exhausted: false },
      pendingPhotoVideo: [],
      pendingDocument: [],
    };
  }

  it('1. Rejects cursor and wipes pending buffers when peerId changes (#Gudang -> #ChannelBaru)', () => {
    const staleCursor: TgScopedMediaSearchCursor = {
      scope: {
        accountId: 'session_user_1',
        peerId: '1001234567', // #Gudang
        topicId: null,
      },
      photoVideo: { fetchOffsetId: 15000, exhausted: false },
      document: { fetchOffsetId: 12000, exhausted: false },
      pendingPhotoVideo: [{ id: 14990, name: 'stale_gudang.jpg', size: 100, iconType: 'photo' } as any],
      pendingDocument: [{ id: 11990, name: 'stale_gudang.zip', size: 200, iconType: 'file' } as any],
    };

    const newScope: TgSearchScope = {
      accountId: 'session_user_1',
      peerId: '1009876543', // #ChannelBaru
      topicId: null,
    };

    const normalized = normalizeSearchCursorContract(staleCursor, newScope);
    expect(normalized.scope.peerId).toBe('1009876543');
    expect(normalized.photoVideo.fetchOffsetId).toBe(0);
    expect(normalized.document.fetchOffsetId).toBe(0);
    expect(normalized.pendingPhotoVideo).toEqual([]);
    expect(normalized.pendingDocument).toEqual([]);
  });

  it('2. Rejects cursor and starts fresh when topicId changes within the same forum channel', () => {
    const staleCursor: TgScopedMediaSearchCursor = {
      scope: {
        accountId: 'session_user_1',
        peerId: '1001234567',
        topicId: 42,
      },
      photoVideo: { fetchOffsetId: 9500, exhausted: false },
      document: { fetchOffsetId: 8100, exhausted: false },
      pendingPhotoVideo: [],
      pendingDocument: [],
    };

    const newScope: TgSearchScope = {
      accountId: 'session_user_1',
      peerId: '1001234567',
      topicId: 99,
    };

    const normalized = normalizeSearchCursorContract(staleCursor, newScope);
    expect(normalized.scope.topicId).toBe(99);
    expect(normalized.photoVideo.fetchOffsetId).toBe(0);
    expect(normalized.document.fetchOffsetId).toBe(0);
  });

  it('3. Rejects cursor and starts fresh when accountId changes', () => {
    const staleCursor: TgScopedMediaSearchCursor = {
      scope: {
        accountId: 'session_user_A',
        peerId: '1001234567',
        topicId: null,
      },
      photoVideo: { fetchOffsetId: 5000, exhausted: false },
      document: { fetchOffsetId: 4000, exhausted: false },
      pendingPhotoVideo: [],
      pendingDocument: [],
    };

    const newScope: TgSearchScope = {
      accountId: 'session_user_B',
      peerId: '1001234567',
      topicId: null,
    };

    const normalized = normalizeSearchCursorContract(staleCursor, newScope);
    expect(normalized.scope.accountId).toBe('session_user_B');
    expect(normalized.photoVideo.fetchOffsetId).toBe(0);
  });

  it('4. Retains and advances cursor and pending buffer when scope matches perfectly', () => {
    const validCursor: TgScopedMediaSearchCursor = {
      scope: {
        accountId: 'session_user_1',
        peerId: '1001234567',
        topicId: null,
      },
      photoVideo: { fetchOffsetId: 901, exhausted: false },
      document: { fetchOffsetId: 701, exhausted: false },
      pendingPhotoVideo: [{ id: 900, name: 'valid.jpg', size: 100, iconType: 'photo' } as any],
      pendingDocument: [{ id: 700, name: 'valid.pdf', size: 200, iconType: 'file' } as any],
    };

    const matchingScope: TgSearchScope = {
      accountId: 'session_user_1',
      peerId: '1001234567',
      topicId: null,
    };

    const normalized = normalizeSearchCursorContract(validCursor, matchingScope);
    expect(normalized).toEqual(validCursor);
    expect(normalized.pendingPhotoVideo?.length).toBe(1);
    expect(normalized.pendingDocument?.length).toBe(1);
  });

  it('5. HasMore requires BOTH lanes exhausted AND all pending buffers empty', () => {
    function hasMoreWork(cursor: TgScopedMediaSearchCursor): boolean {
      return (
        !cursor.photoVideo.exhausted ||
        !cursor.document.exhausted ||
        (cursor.pendingPhotoVideo?.length ?? 0) > 0 ||
        (cursor.pendingDocument?.length ?? 0) > 0
      );
    }

    // Both lanes exhausted but pending buffer still has items
    const cursorWithBufferedItems: TgScopedMediaSearchCursor = {
      scope: { accountId: 's1', peerId: 'p1', topicId: null },
      photoVideo: { fetchOffsetId: 1, exhausted: true },
      document: { fetchOffsetId: 1, exhausted: true },
      pendingPhotoVideo: [{ id: 50, name: 'buffered.jpg', size: 10, iconType: 'photo' } as any],
      pendingDocument: [],
    };
    expect(hasMoreWork(cursorWithBufferedItems)).toBe(true);

    // Both exhausted and no pending items
    const fullyExhaustedCursor: TgScopedMediaSearchCursor = {
      scope: { accountId: 's1', peerId: 'p1', topicId: null },
      photoVideo: { fetchOffsetId: 1, exhausted: true },
      document: { fetchOffsetId: 1, exhausted: true },
      pendingPhotoVideo: [],
      pendingDocument: [],
    };
    expect(hasMoreWork(fullyExhaustedCursor)).toBe(false);
  });
});
