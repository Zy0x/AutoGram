/**
 * useChannelSync.ts — React Hook for Telegram Channel Synchronization (P2.5)
 *
 * Connects foreground MediaStudio view to Rust ChannelSyncWorker, applies mutation batches
 * atomically with channel PTS to IndexedDB, and sends typed post-commit Storage ACKs.
 */

import { useEffect, useRef, useState } from 'react';
import {
  getChannelSyncState,
  saveChannelMutationsAndPts,
  CHANNEL_SYNC_SCHEMA_VERSION,
  type ChannelSyncState,
  type MediaMutation,
} from '../../../lib/db/mediaStudioDb';
import {
  startChannelSync,
  detachChannelSync,
  setChannelSyncActiveView,
  sendChannelSyncStorageAck,
  type ChannelSyncEvent,
  type ChannelSyncStatus,
  type TgTelegramIdentity,
} from '../../../lib/telegram/channelSyncWorkerApi';

export interface UseChannelSyncOptions {
  identity?: TgTelegramIdentity | null;
  peerId?: string | number | null;
  isChannelOrSupergroup?: boolean;
  isActivelyViewed?: boolean;
  onMutationsCommitted?: (mutations: MediaMutation[]) => void;
}

export interface UseChannelSyncResult {
  syncId: number | null;
  status: ChannelSyncStatus;
  currentPts: number;
  isLiveSynced: boolean;
  error: string | null;
  reconcileRequired: boolean;
}

export function useChannelSync({
  identity,
  peerId,
  isChannelOrSupergroup = false,
  isActivelyViewed = true,
  onMutationsCommitted,
}: UseChannelSyncOptions): UseChannelSyncResult {
  const [syncId, setSyncId] = useState<number | null>(null);
  const [status, setStatus] = useState<ChannelSyncStatus>('preparing');
  const [currentPts, setCurrentPts] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [reconcileRequired, setReconcileRequired] = useState<boolean>(false);

  const subscriberMetaRef = useRef<{ subscriberId: number; generation: number } | null>(null);
  const activeSyncIdRef = useRef<number | null>(null);
  const onMutationsCommittedRef = useRef(onMutationsCommitted);
  onMutationsCommittedRef.current = onMutationsCommitted;

  const targetPeerStr = peerId != null ? String(peerId).trim() : '';
  const sessionKey = identity?.session?.trim() || '';

  // Synchronize active-view foreground state with Rust short polling
  useEffect(() => {
    if (activeSyncIdRef.current != null) {
      setChannelSyncActiveView(activeSyncIdRef.current, isActivelyViewed).catch(() => {});
    }
  }, [isActivelyViewed]);

  useEffect(() => {
    if (!sessionKey || !targetPeerStr || !isChannelOrSupergroup || !identity) {
      setSyncId(null);
      activeSyncIdRef.current = null;
      setStatus('stopped');
      return;
    }

    let isSubscribed = true;
    let localSyncId: number | null = null;
    let localSubMeta: { subscriberId: number; generation: number } | null = null;

    async function initSync() {
      try {
        setError(null);
        setReconcileRequired(false);

        // 1. Read existing durable sync state from IndexedDB
        const existingState = await getChannelSyncState(sessionKey, targetPeerStr);
        if (!isSubscribed) return;

        if (existingState?.pts) {
          setCurrentPts(existingState.pts);
        }

        const activeIdentity = identity;
        if (!activeIdentity) return;

        // 2. Start or attach to Rust ChannelSyncWorker
        const startReq = {
          clientRequestId: `sync_${sessionKey}_${targetPeerStr}_${Date.now()}`,
          identity: activeIdentity,
          peerId: targetPeerStr,
          initialPts: existingState?.pts ?? null,
          isActivelyViewed,
        };

        const response = await startChannelSync(startReq, async (event: ChannelSyncEvent) => {
          if (!isSubscribed) return;

          if (event.type === 'state') {
            setStatus(event.state);
          } else if (event.type === 'batch') {
            try {
              // Construct next durable state
              const nextState: ChannelSyncState = {
                accountId: sessionKey,
                peerId: targetPeerStr,
                pts: event.candidatePts,
                baselineReady: true,
                baselineReconciled: true,
                lastAppliedAt: Date.now(),
                lastDifferenceAt:
                  event.source === 'difference' || event.source === 'difference_empty'
                    ? Date.now()
                    : existingState?.lastDifferenceAt ?? 0,
                schemaVersion: CHANNEL_SYNC_SCHEMA_VERSION,
              };

              // Commit atomically to IndexedDB alongside mutations
              await saveChannelMutationsAndPts(event.mutations, nextState);

              // Send post-commit storage ACK to Rust
              await sendChannelSyncStorageAck(
                event.syncId,
                event.batchId,
                'committed',
                event.candidatePts
              );

              if (isSubscribed) {
                setCurrentPts(event.candidatePts);
                setStatus('live_synced');
                if (event.mutations.length > 0 && onMutationsCommittedRef.current) {
                  onMutationsCommittedRef.current(event.mutations);
                }
              }
            } catch (err: any) {
              console.error('[useChannelSync] Storage commit error:', err);
              await sendChannelSyncStorageAck(
                event.syncId,
                event.batchId,
                'failed',
                undefined,
                String(err?.message || err)
              );
              if (isSubscribed) {
                setError(String(err?.message || err));
              }
            }
          } else if (event.type === 'gap_detected') {
            setStatus('gap_grace');
          } else if (event.type === 'reconcile_required') {
            setStatus('reconcile_required');
            setReconcileRequired(true);
          } else if (event.type === 'failed') {
            setStatus('failed');
            setError(event.message);
          }
        });

        if (!isSubscribed) {
          detachChannelSync(response.syncId, response.subscriberId, response.generation).catch(
            () => {}
          );
          return;
        }

        localSyncId = response.syncId;
        localSubMeta = {
          subscriberId: response.subscriberId,
          generation: response.generation,
        };
        activeSyncIdRef.current = response.syncId;
        subscriberMetaRef.current = localSubMeta;

        setSyncId(response.syncId);
        setStatus(response.state);
        setCurrentPts(response.currentPts);
      } catch (err: any) {
        if (isSubscribed) {
          console.error('[useChannelSync] Init error:', err);
          setStatus('failed');
          setError(String(err?.message || err));
        }
      }
    }

    initSync();

    return () => {
      isSubscribed = false;
      if (localSyncId != null && localSubMeta != null) {
        detachChannelSync(localSyncId, localSubMeta.subscriberId, localSubMeta.generation).catch(
          () => {}
        );
      }
      activeSyncIdRef.current = null;
      subscriberMetaRef.current = null;
    };
  }, [sessionKey, targetPeerStr, isChannelOrSupergroup, identity, isActivelyViewed]);

  return {
    syncId,
    status,
    currentPts,
    isLiveSynced: status === 'live_synced',
    error,
    reconcileRequired,
  };
}
