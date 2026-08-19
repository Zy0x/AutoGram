import { describe, expect, it } from 'vitest';
import {
  buildDriveMediaContext,
  normalizeTopicId,
  advanceBackfillOffset,
  mergeMediaIndexCheckpoint,
  type MediaIndexState,
  type MediaIndexCheckpointUpdate,
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

  describe('P1.6 advanceBackfillOffset Monotonicity & Zero-Watermark Protection', () => {
    it('1. PV page without PV row (incoming 0) does not regress existing PV offset to 0', () => {
      const existing = 12000;
      const incoming = 0;
      expect(advanceBackfillOffset(existing, incoming)).toBe(12000);
    });

    it('2. DOC page without DOC row (incoming undefined) does not regress existing DOC offset', () => {
      const existing = 8500;
      const incoming = undefined;
      expect(advanceBackfillOffset(existing, incoming)).toBe(8500);
    });

    it('3. Advances offset when incoming is older/smaller ID (5000 -> 4500)', () => {
      expect(advanceBackfillOffset(5000, 4500)).toBe(4500);
    });

    it('4. Refuses to regress backwards if incoming is larger/newer ID (4500 -> 5000)', () => {
      expect(advanceBackfillOffset(4500, 5000)).toBe(4500);
    });

    it('5. Initializes offset when existing is 0', () => {
      expect(advanceBackfillOffset(0, 9500)).toBe(9500);
    });
  });

  describe('P1.6 mergeMediaIndexCheckpoint Reducer Invariants', () => {
    const baseState: MediaIndexState = {
      accountId: 'session_user_1',
      peerId: '1001234567',
      scopeKind: 'all',
      topicIdNormalized: -1,
      pvCommittedOffset: 12000,
      docCommittedOffset: 11000,
      pvExhausted: false,
      docExhausted: false,
      newestCommittedId: 15000,
      oldestCommittedId: 11000,
      backfillComplete: false,
      exactMediaCount: null,
      exactBytes: null,
      pts: null,
      schemaVersion: 1,
      startedAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    it('1. Server exhausted + pending != empty results in durable exhausted = false', () => {
      const update: MediaIndexCheckpointUpdate = {
        accountId: 'session_user_1',
        peerId: '1001234567',
        scopeKind: 'all',
        topicIdNormalized: -1,
        pvCommittedOffset: 10500,
        docCommittedOffset: 10000,
        pvCommittedExhausted: false, // pending not empty!
        docCommittedExhausted: false,
        backfillComplete: false,
      };

      const nextState = mergeMediaIndexCheckpoint(baseState, update, [], 1700000010000);
      expect(nextState.pvExhausted).toBe(false);
      expect(nextState.docExhausted).toBe(false);
      expect(nextState.backfillComplete).toBe(false);
    });

    it('2. When both lanes drained, durable exhausted and backfillComplete become true', () => {
      const update: MediaIndexCheckpointUpdate = {
        accountId: 'session_user_1',
        peerId: '1001234567',
        scopeKind: 'all',
        topicIdNormalized: -1,
        pvCommittedOffset: 1,
        docCommittedOffset: 1,
        pvCommittedExhausted: true,
        docCommittedExhausted: true,
        backfillComplete: true,
      };

      const nextState = mergeMediaIndexCheckpoint(baseState, update, [], 1700000020000);
      expect(nextState.pvExhausted).toBe(true);
      expect(nextState.docExhausted).toBe(true);
      expect(nextState.backfillComplete).toBe(true);
      expect(nextState.pvCommittedOffset).toBe(1);
      expect(nextState.docCommittedOffset).toBe(1);
    });

    it('3. Computes newestCommittedId and oldestCommittedId monotonically from batch rows', () => {
      const rows = [
        { id: 9800 } as any,
        { id: 10200 } as any,
        { id: 8500 } as any,
      ];

      const update: MediaIndexCheckpointUpdate = {
        accountId: 'session_user_1',
        peerId: '1001234567',
        scopeKind: 'all',
        topicIdNormalized: -1,
        pvCommittedOffset: 8500,
        docCommittedOffset: 8500,
      };

      const nextState = mergeMediaIndexCheckpoint(baseState, update, rows, 1700000030000);
      // Newest was 15000, batch max is 10200 -> stays 15000
      expect(nextState.newestCommittedId).toBe(15000);
      // Oldest was 11000, batch min is 8500 -> advances down to 8500
      expect(nextState.oldestCommittedId).toBe(8500);
      expect(nextState.pvCommittedOffset).toBe(8500);
      expect(nextState.docCommittedOffset).toBe(8500);
    });
  });
});
