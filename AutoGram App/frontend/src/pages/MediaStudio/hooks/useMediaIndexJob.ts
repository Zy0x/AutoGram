/**
 * useMediaIndexJob.ts — React Controller Hook for Long-Running Rust Media Index Worker (P3.1 Hardened)
 *
 * Connects the MediaStudio UI to Rust via Tauri Channel, handles candidate checkpoints,
 * persists media batches atomically to IndexedDB, and sends typed ACK backpressure responses.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import {
  ackMediaIndexPage,
  attachMediaIndexJobChannel,
  cancelMediaIndexJob,
  detachMediaIndexJobChannel,
  pauseMediaIndexJob,
  resumeMediaIndexJob,
  startMediaIndexJob,
  type TgMediaIndexEvent,
  type TgMediaIndexJobState,
  type TgMediaIndexMetricsSnapshot,
} from '../../../lib/telegram/mediaIndexWorkerApi';
import {
  buildDriveMediaContext,
  getExactMediaStatsByContext,
  getMediaIndexState,
  saveMediaBatchAndCheckpoint,
  scopeMediaRecords,
} from '../../../lib/db/mediaStudioDb';

export interface UseMediaIndexJobOptions {
  session?: string | null;
  apiId?: number | null;
  apiHash?: string | null;
  peerId?: string | number | null;
  topicId?: number | null;
  onNewPage?: (files: DriveFile[]) => void;
  onComplete?: (exactStats?: { count: number; totalBytes: number }) => void;
  onError?: (error: string) => void;
}

export interface UseMediaIndexJobReturn {
  jobId: number | null;
  state: TgMediaIndexJobState | 'idle';
  isIndexing: boolean;
  isPaused: boolean;
  floodWaitRemaining: number | null;
  metrics: TgMediaIndexMetricsSnapshot | null;
  exactStats: { count: number; totalBytes: number } | null;
  error: string | null;
  start: (forceMode?: 'historical_backfill' | 'delta_sync') => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  attach: (jobId: number) => Promise<void>;
}

export function useMediaIndexJob(options: UseMediaIndexJobOptions): UseMediaIndexJobReturn {
  const { session, apiId, apiHash, peerId, topicId, onNewPage, onComplete, onError } = options;

  const [jobId, setJobId] = useState<number | null>(null);
  const [state, setState] = useState<TgMediaIndexJobState | 'idle'>('idle');
  const [metrics, setMetrics] = useState<TgMediaIndexMetricsSnapshot | null>(null);
  const [exactStats, setExactStats] = useState<{
    count: number;
    totalBytes: number;
  } | null>(null);
  const [floodWaitRemaining, setFloodWaitRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeJobIdRef = useRef<number | null>(null);
  const subscriberRef = useRef<{ subscriberId: number; generation: number } | null>(null);
  const floodTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const clearFloodTimer = () => {
    if (floodTimerRef.current) {
      clearInterval(floodTimerRef.current);
      floodTimerRef.current = null;
    }
    setFloodWaitRemaining(null);
  };

  const handleChannelEvent = useCallback(
    async (event: TgMediaIndexEvent) => {
      if (!isMountedRef.current) return;

      switch (event.type) {
        case 'state': {
          setState(event.state);
          if (event.state === 'running' || event.state === 'completed') {
            clearFloodTimer();
          }
          break;
        }

        case 'page': {
          setState('waiting_ack');
          setMetrics(event.metrics);

          const curSession = session || '';
          const curPeer = peerId ? String(peerId) : '';
          const context = buildDriveMediaContext(curSession, curPeer, topicId ?? null);
          const parsedFolderId = Number(curPeer) || 0;

          try {
            // 1. Scope and format media records
            const scopedRecords = scopeMediaRecords(event.rows, context, parsedFolderId);

            // 2. Commit atomically to IndexedDB alongside candidate checkpoint
            const committedState = await saveMediaBatchAndCheckpoint(
              scopedRecords,
              {
                ...event.candidateCheckpoint,
                scopeKind: event.candidateCheckpoint.scopeKind === 'topic' ? 'topic' : 'all',
                mode: event.candidateCheckpoint.mode === 'delta' ? 'delta' : 'backfill',
              }
            );

            // 3. Send storage ACK to Rust
            await ackMediaIndexPage({
              jobId: event.jobId,
              ackId: event.ackId,
              outcome: 'committed',
              committedState,
            });

            // 4. Notify UI of new items
            if (onNewPage && event.rows.length > 0) {
              onNewPage(event.rows);
            }
          } catch (err: any) {
            console.error('[P3 Indexer] IndexedDB commit error:', err);
            await ackMediaIndexPage({
              jobId: event.jobId,
              ackId: event.ackId,
              outcome: 'failed',
              errorCode: String(err?.message || err),
            });
            setError(String(err?.message || err));
            if (onError) onError(String(err?.message || err));
          }
          break;
        }

        case 'progress': {
          setMetrics(event.metrics);
          setState(event.state);
          break;
        }

        case 'flood': {
          setState('flood_paused');
          const resumeAt = event.resumeAtMs;
          clearFloodTimer();

          const updateCountdown = () => {
            const rem = Math.max(0, Math.ceil((resumeAt - Date.now()) / 1000));
            setFloodWaitRemaining(rem);
            if (rem <= 0) {
              clearFloodTimer();
            }
          };

          updateCountdown();
          floodTimerRef.current = setInterval(updateCountdown, 1000);
          break;
        }

        case 'complete': {
          setState('completed');
          setMetrics(event.metrics);
          clearFloodTimer();

          const curSession = session || '';
          const curPeer = peerId ? String(peerId) : '';
          const context = buildDriveMediaContext(curSession, curPeer, topicId ?? null);

          // Perform authoritative exact count refresh
          void getExactMediaStatsByContext(context).then((stats) => {
            if (isMountedRef.current && stats) {
              setExactStats(stats);
              if (onComplete) onComplete(stats);
            } else if (onComplete) {
              onComplete();
            }
          });
          break;
        }

        case 'failed': {
          setState('failed');
          setError(event.message);
          clearFloodTimer();
          if (onError) onError(event.message);
          break;
        }
      }
    },
    [session, peerId, topicId, onNewPage, onComplete, onError]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (floodTimerRef.current) {
        clearInterval(floodTimerRef.current);
        floodTimerRef.current = null;
      }
      const curJobId = activeJobIdRef.current;
      const curSub = subscriberRef.current;
      if (curJobId && curSub) {
        void detachMediaIndexJobChannel(curJobId, curSub.subscriberId, curSub.generation);
      }
    };
  }, []);

  const attach = useCallback(
    async (targetJobId: number) => {
      try {
        const res = await attachMediaIndexJobChannel(targetJobId, (evt: TgMediaIndexEvent) => {
          void handleChannelEvent(evt);
        });

        if (res.attached) {
          setJobId(targetJobId);
          activeJobIdRef.current = targetJobId;
          subscriberRef.current = {
            subscriberId: res.subscriberId,
            generation: res.generation,
          };
          setState(res.state);
        }
      } catch (err) {
        console.error('[P3.1 Indexer] Attach channel failed:', err);
      }
    },
    [handleChannelEvent]
  );

  const start = useCallback(
    async (forceMode?: 'historical_backfill' | 'delta_sync') => {
      if (!session || !apiId || !apiHash || !peerId) {
        const msg = 'Missing session, credentials, or target peer for indexing';
        setError(msg);
        if (onError) onError(msg);
        return;
      }

      setError(null);
      setState('preparing');
      clearFloodTimer();

      try {
        const curPeer = String(peerId);
        const context = buildDriveMediaContext(session, curPeer, topicId ?? null);

        // Read initial durable checkpoint from IndexedDB
        const initialState = await getMediaIndexState(context);

        // Cryptographically secure UUID per invocation (never contain session string)
        const clientRequestId = crypto.randomUUID();

        const res = await startMediaIndexJob(
          {
            clientRequestId,
            identity: {
              session,
              apiId: Number(apiId),
              apiHash,
            },
            peerId: curPeer,
            topicId: topicId ?? null,
            pageSize: 100,
            initialState,
            forceMode: forceMode ?? null,
          },
          (evt: TgMediaIndexEvent) => {
            void handleChannelEvent(evt);
          }
        );

        setJobId(res.jobId);
        activeJobIdRef.current = res.jobId;
        subscriberRef.current = {
          subscriberId: 1,
          generation: 1,
        };
        setState(res.state);
      } catch (err: any) {
        console.error('[P3 Indexer] Start job failed:', err);
        const msg = String(err?.message || err);
        setState('failed');
        setError(msg);
        if (onError) onError(msg);
      }
    },
    [session, apiId, apiHash, peerId, topicId, handleChannelEvent, onError]
  );

  const pause = useCallback(async () => {
    const currentId = activeJobIdRef.current || jobId;
    if (!currentId) return;
    try {
      const res = await pauseMediaIndexJob(currentId);
      setState(res.state);
    } catch (err) {
      console.error('[P3 Indexer] Pause failed:', err);
    }
  }, [jobId]);

  const resume = useCallback(async () => {
    const currentId = activeJobIdRef.current || jobId;
    if (!currentId) return;
    try {
      const res = await resumeMediaIndexJob(currentId);
      setState(res.state);
    } catch (err) {
      console.error('[P3 Indexer] Resume failed:', err);
    }
  }, [jobId]);

  const cancel = useCallback(async () => {
    const currentId = activeJobIdRef.current || jobId;
    if (!currentId) return;
    try {
      const res = await cancelMediaIndexJob(currentId);
      setState(res.state);
      clearFloodTimer();
    } catch (err) {
      console.error('[P3 Indexer] Cancel failed:', err);
    }
  }, [jobId]);

  const isIndexing =
    state === 'preparing' ||
    state === 'running' ||
    state === 'waiting_ack' ||
    state === 'waiting_frontend' ||
    state === 'flood_paused';
  const isPaused = state === 'user_paused';

  return {
    jobId,
    state,
    isIndexing,
    isPaused,
    floodWaitRemaining,
    metrics,
    exactStats,
    error,
    start,
    pause,
    resume,
    cancel,
    attach,
  };
}
