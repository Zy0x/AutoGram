import { describe, expect, it } from 'vitest';
import {
  buildDriveMediaContext,
  normalizeTopicId,
  advanceBackfillOffset,
  mergeMediaIndexCheckpoint,
  MEDIA_INDEX_SCHEMA_VERSION,
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

  describe('P1.6 & P2 mergeMediaIndexCheckpoint Reducer & Delta Sync Invariants', () => {
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
      deltaActive: false,
      deltaBaseId: 0,
      deltaPvCommittedOffset: 0,
      deltaDocCommittedOffset: 0,
      deltaPvExhausted: false,
      deltaDocExhausted: false,
      deltaMaxObservedId: 0,
      exactMediaCount: null,
      exactBytes: null,
      pts: null,
      schemaVersion: MEDIA_INDEX_SCHEMA_VERSION,
      startedAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    it('1. Server exhausted + pending != empty results in durable exhausted = false', () => {
      const update: MediaIndexCheckpointUpdate = {
        accountId: 'session_user_1',
        peerId: '1001234567',
        scopeKind: 'all',
        topicIdNormalized: -1,
        mode: 'backfill',
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
        mode: 'backfill',
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
        mode: 'backfill',
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

    it('4. backfillComplete is strictly monotonic (once true, never reverts to false)', () => {
      const completedState: MediaIndexState = {
        ...baseState,
        backfillComplete: true,
      };

      const intermediateUpdate: MediaIndexCheckpointUpdate = {
        accountId: 'session_user_1',
        peerId: '1001234567',
        scopeKind: 'all',
        topicIdNormalized: -1,
        mode: 'backfill',
        backfillComplete: false, // attempt to degrade
      };

      const nextState = mergeMediaIndexCheckpoint(completedState, intermediateUpdate, [], 1700000040000);
      expect(nextState.backfillComplete).toBe(true);
    });

    it('5. Handles zero-media / empty-scope backfill completion checkpoint', () => {
      const freshState: MediaIndexState = {
        accountId: 'session_user_empty',
        peerId: '999999',
        scopeKind: 'all',
        topicIdNormalized: -1,
        pvCommittedOffset: 0,
        docCommittedOffset: 0,
        pvExhausted: false,
        docExhausted: false,
        newestCommittedId: 0,
        oldestCommittedId: 0,
        backfillComplete: false,
        deltaActive: false,
        deltaBaseId: 0,
        deltaPvCommittedOffset: 0,
        deltaDocCommittedOffset: 0,
        deltaPvExhausted: false,
        deltaDocExhausted: false,
        deltaMaxObservedId: 0,
        exactMediaCount: null,
        exactBytes: null,
        pts: null,
        schemaVersion: MEDIA_INDEX_SCHEMA_VERSION,
        startedAt: 1700000000000,
        updatedAt: 1700000000000,
      };

      const emptyCompletedUpdate: MediaIndexCheckpointUpdate = {
        accountId: 'session_user_empty',
        peerId: '999999',
        scopeKind: 'all',
        topicIdNormalized: -1,
        mode: 'backfill',
        pvCommittedOffset: 0,
        docCommittedOffset: 0,
        pvCommittedExhausted: true,
        docCommittedExhausted: true,
        backfillComplete: true,
      };

      const nextState = mergeMediaIndexCheckpoint(freshState, emptyCompletedUpdate, [], 1700000050000);
      expect(nextState.backfillComplete).toBe(true);
      expect(nextState.pvExhausted).toBe(true);
      expect(nextState.docExhausted).toBe(true);
      expect(nextState.newestCommittedId).toBe(0);
      expect(nextState.oldestCommittedId).toBe(0);
    });

    it('6. P2 Delta Mode: In-flight delta does NOT advance newestCommittedId prematurely (anti-data-loss)', () => {
      const completedHistoricalState: MediaIndexState = {
        ...baseState,
        backfillComplete: true,
        newestCommittedId: 10000,
        oldestCommittedId: 100,
        pvCommittedOffset: 1,
        docCommittedOffset: 1,
        pvExhausted: true,
        docExhausted: true,
      };

      // Page 1 of delta: contains messages 10500..10401
      const deltaPage1Rows = [
        { id: 10500 } as any,
        { id: 10450 } as any,
        { id: 10401 } as any,
      ];

      const deltaPage1Update: MediaIndexCheckpointUpdate = {
        accountId: 'session_user_1',
        peerId: '1001234567',
        scopeKind: 'all',
        topicIdNormalized: -1,
        mode: 'delta',
        deltaActive: true,
        deltaBaseId: 10000,
        deltaPvCommittedOffset: 10401,
        deltaDocCommittedOffset: 10401,
        deltaPvCommittedExhausted: false,
        deltaDocCommittedExhausted: false,
        deltaComplete: false,
      };

      const stateAfterPage1 = mergeMediaIndexCheckpoint(completedHistoricalState, deltaPage1Update, deltaPage1Rows, 1700000060000);

      // CRITICAL: Canonical newestCommittedId remains 10000 during in-flight delta!
      expect(stateAfterPage1.newestCommittedId).toBe(10000);
      // Historical offsets remain untouched
      expect(stateAfterPage1.pvCommittedOffset).toBe(1);
      expect(stateAfterPage1.docCommittedOffset).toBe(1);
      // Delta state tracks in-flight progress
      expect(stateAfterPage1.deltaActive).toBe(true);
      expect(stateAfterPage1.deltaBaseId).toBe(10000);
      expect(stateAfterPage1.deltaMaxObservedId).toBe(10500);
      expect(stateAfterPage1.deltaPvCommittedOffset).toBe(10401);
      expect(stateAfterPage1.deltaDocCommittedOffset).toBe(10401);
    });

    it('7. P2 Delta Mode: Finalizes newestCommittedId only upon delta completion ACK', () => {
      const stateInFlight: MediaIndexState = {
        ...baseState,
        backfillComplete: true,
        newestCommittedId: 10000,
        deltaActive: true,
        deltaBaseId: 10000,
        deltaPvCommittedOffset: 10401,
        deltaDocCommittedOffset: 10401,
        deltaMaxObservedId: 10500,
      };

      // Final page of delta: messages 10400..10001
      const deltaFinalRows = [
        { id: 10400 } as any,
        { id: 10001 } as any,
      ];

      const deltaFinalUpdate: MediaIndexCheckpointUpdate = {
        accountId: 'session_user_1',
        peerId: '1001234567',
        scopeKind: 'all',
        topicIdNormalized: -1,
        mode: 'delta',
        deltaActive: false,
        deltaBaseId: 10000,
        deltaPvCommittedOffset: 10001,
        deltaDocCommittedOffset: 10001,
        deltaPvCommittedExhausted: true,
        deltaDocCommittedExhausted: true,
        deltaComplete: true,
      };

      const finalState = mergeMediaIndexCheckpoint(stateInFlight, deltaFinalUpdate, deltaFinalRows, 1700000070000);

      // Now canonical newestCommittedId is updated to the maximum observed ID 10500!
      expect(finalState.newestCommittedId).toBe(10500);
      expect(finalState.deltaActive).toBe(false);
      expect(finalState.deltaBaseId).toBe(0);
      expect(finalState.deltaMaxObservedId).toBe(0);
      expect(finalState.deltaPvCommittedOffset).toBe(0);
      expect(finalState.deltaDocCommittedOffset).toBe(0);
    });
  });

  describe('P2.5 ChannelSyncState & Atomic Mutation Contract', () => {
    it('1. Defines CHANNEL_SYNC_SCHEMA_VERSION as 1', async () => {
      const { CHANNEL_SYNC_SCHEMA_VERSION } = await import('./mediaStudioDb');
      expect(CHANNEL_SYNC_SCHEMA_VERSION).toBe(1);
    });

    it('2. Enforces positive PTS and non-empty accountId & peerId', async () => {
      const { saveChannelMutationsAndPts } = await import('./mediaStudioDb');
      
      const invalidState = {
        accountId: '',
        peerId: '100123',
        pts: 0,
        baselineReady: false,
        baselineReconciled: false,
        lastAppliedAt: 0,
        lastDifferenceAt: 0,
        schemaVersion: 1,
      };

      await expect(
        saveChannelMutationsAndPts([], invalidState)
      ).rejects.toThrow('Invalid channelSyncState');
    });

    it('3. Rejects invalid upsert mutations with non-positive message_id or missing row', async () => {
      const { saveChannelMutationsAndPts } = await import('./mediaStudioDb');

      const validState = {
        accountId: 'test_acc',
        peerId: 'test_peer',
        pts: 100,
        baselineReady: true,
        baselineReconciled: true,
        lastAppliedAt: Date.now(),
        lastDifferenceAt: 0,
        schemaVersion: 1,
      };

      const invalidUpsertMutation = {
        action: 'upsert' as const,
        peer_id: 'test_peer',
        message_id: 0,
        topic_id: null,
        row: null as any,
      };

      await expect(
        saveChannelMutationsAndPts([invalidUpsertMutation], validState)
      ).rejects.toThrow('Invalid upsert mutation');
    });

    it('4. Rejects invalid delete mutations with empty message_ids', async () => {
      const { saveChannelMutationsAndPts } = await import('./mediaStudioDb');

      const validState = {
        accountId: 'test_acc',
        peerId: 'test_peer',
        pts: 100,
        baselineReady: true,
        baselineReconciled: true,
        lastAppliedAt: Date.now(),
        lastDifferenceAt: 0,
        schemaVersion: 1,
      };

      const invalidDeleteMutation = {
        action: 'delete' as const,
        peer_id: 'test_peer',
        message_ids: [],
      };

      await expect(
        saveChannelMutationsAndPts([invalidDeleteMutation], validState)
      ).rejects.toThrow('Invalid delete mutation');
    });

    it('5. hasCachedMediaRecords returns boolean without throwing', async () => {
      const { hasCachedMediaRecords } = await import('./mediaStudioDb');
      const exists = await hasCachedMediaRecords('test_acc', 'test_peer_empty');
      expect(typeof exists).toBe('boolean');
    });
  });
});
