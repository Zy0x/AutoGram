/**
 * useChannelSync.ts — React Hook for Telegram Channel Synchronization (P2.5 Hardened)
 *
 * Connects foreground MediaStudio view to Rust ChannelSyncWorker, applies mutation batches
 * atomically with channel PTS to IndexedDB, manages bootstrap baseline durability,
 * enforces document visibility awareness, and coordinates authoritative reconciliation completion.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getChannelSyncState,
  hasCachedMediaRecords,
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
  completeChannelSyncReconcile,
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
  onAuthoritativeReconcileRequired?: (latestPts: number) => void;
}

export interface UseChannelSyncResult {
  syncId: number | null;
  status: ChannelSyncStatus;
  currentPts: number;
  isLiveSynced: boolean;
  error: string | null;
  reconcileRequired: boolean;
  rebaselineAfterReconcile: (reconciledPts: number) => Promise<void>;
}

export function useChannelSync({
  identity,
  peerId,
  isChannelOrSupergroup = false,
  isActivelyViewed = true,
  onMutationsCommitted,
  onAuthoritativeReconcileRequired,
}: UseChannelSyncOptions): UseChannelSyncResult {
  const [syncId, setSyncId] = useState<number | null>(null);
  const [status, setStatus] = useState<ChannelSyncStatus>('preparing');
  const [currentPts, setCurrentPts] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [reconcileRequired, setReconcileRequired] = useState<boolean>(false);

  const subscriberMetaRef = useRef<{ subscriberId: number; generation: number } | null>(null);
  const activeSyncIdRef = useRef<number | null>(null);
  const channelSyncStateRef = useRef<ChannelSyncState | null>(null);
  const onMutationsCommittedRef = useRef(onMutationsCommitted);
  onMutationsCommittedRef.current = onMutationsCommitted;
  const onReconcileRef = useRef(onAuthoritativeReconcileRequired);
  onReconcileRef.current = onAuthoritativeReconcileRequired;

  const targetPeerStr = peerId != null ? String(peerId).trim() : '';
  const sessionKey = identity?.session?.trim() || '';

  // Synchronize active-view foreground state with document visibility + short polling
  useEffect(() => {
    const updateActive = () => {
      const isVisible = typeof document !== 'undefined' ? !document.hidden : true;
      const effectiveActive = isActivelyViewed && isVisible;
      if (activeSyncIdRef.current != null) {
        setChannelSyncActiveView(activeSyncIdRef.current, effectiveActive).catch(() => {});
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', updateActive);
      window.addEventListener('focus', updateActive);
      window.addEventListener('blur', updateActive);
    }
    updateActive();

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', updateActive);
        window.removeEventListener('focus', updateActive);
        window.removeEventListener('blur', updateActive);
      }
    };
  }, [isActivelyViewed]);

  const rebaselineAfterReconcile = useCallback(async (reconciledPts: number) => {
    if (!sessionKey || !targetPeerStr) return;
    const nextState: ChannelSyncState = {
      accountId: sessionKey,
      peerId: targetPeerStr,
      pts: reconciledPts,
      baselineReady: true,
      baselineReconciled: true,
      lastAppliedAt: Date.now(),
      lastDifferenceAt: Date.now(),
      schemaVersion: CHANNEL_SYNC_SCHEMA_VERSION,
    };
    await saveChannelMutationsAndPts([], nextState, { allowRebaseline: true });
    channelSyncStateRef.current = nextState;

    if (activeSyncIdRef.current != null) {
      await completeChannelSyncReconcile(activeSyncIdRef.current, reconciledPts);
    }

    setCurrentPts(reconciledPts);
    setReconcileRequired(false);
    setStatus('live_synced');
  }, [sessionKey, targetPeerStr]);

  useEffect(() => {
    if (!sessionKey || !targetPeerStr || !isChannelOrSupergroup || !identity) {
      setSyncId(null);
      activeSyncIdRef.current = null;
      channelSyncStateRef.current = null;
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

        // 1. Read existing durable sync state from IndexedDB into Ref
        const existingState = await getChannelSyncState(sessionKey, targetPeerStr);
        if (!isSubscribed) return;
        channelSyncStateRef.current = existingState;

        if (existingState?.pts) {
          setCurrentPts(existingState.pts);
          if (!existingState.baselineReconciled) {
            setReconcileRequired(true);
          }
        }

        const activeIdentity = identity;
        if (!activeIdentity) return;

        // 2. Start or attach to Rust ChannelSyncWorker
        const startReq = {
          clientRequestId: `sync_${sessionKey}_${targetPeerStr}_${Date.now()}`,
          identity: activeIdentity,
          peerId: targetPeerStr,
          initialPts: existingState?.pts ?? null,
          isActivelyViewed: isActivelyViewed && (typeof document !== 'undefined' ? !document.hidden : true),
        };

        const response = await startChannelSync(startReq, async (event: ChannelSyncEvent) => {
          if (!isSubscribed) return;

          if (event.type === 'state') {
            setStatus(event.state);
          } else if (event.type === 'batch') {
            try {
              const currentDurable = channelSyncStateRef.current;
              let isReconciled = currentDurable?.baselineReconciled ?? true;

              // Check bootstrap baseline condition
              if (event.source === 'bootstrap') {
                const hasExistingCache = await hasCachedMediaRecords(sessionKey, targetPeerStr);
                isReconciled = !hasExistingCache;
              }

              // Construct next durable state
              const nextState: ChannelSyncState = {
                accountId: sessionKey,
                peerId: targetPeerStr,
                pts: event.candidatePts,
                baselineReady: true,
                baselineReconciled: isReconciled,
                lastAppliedAt: Date.now(),
                lastDifferenceAt:
                  event.source === 'difference' || event.source === 'difference_empty'
                    ? Date.now()
                    : currentDurable?.lastDifferenceAt ?? 0,
                schemaVersion: CHANNEL_SYNC_SCHEMA_VERSION,
              };

              // Commit atomically to IndexedDB alongside mutations
              await saveChannelMutationsAndPts(event.mutations, nextState, {
                allowRebaseline: event.source === 'bootstrap',
              });
              channelSyncStateRef.current = nextState;

              // Send post-commit storage ACK to Rust
              await sendChannelSyncStorageAck(
                event.syncId,
                event.batchId,
                'committed',
                event.candidatePts
              );

              if (isSubscribed) {
                setCurrentPts(event.candidatePts);
                if (isReconciled) {
                  setStatus('live_synced');
                  setReconcileRequired(false);
                } else {
                  setStatus('reconcile_required');
                  setReconcileRequired(true);
                  if (onReconcileRef.current) {
                    onReconcileRef.current(event.candidatePts);
                  }
                }
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
            if (onReconcileRef.current) {
              onReconcileRef.current(event.latestPts);
            }
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
    isLiveSynced: status === 'live_synced' && !reconcileRequired,
    error,
    reconcileRequired,
    rebaselineAfterReconcile,
  };
}
