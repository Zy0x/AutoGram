/**
 * mediaIndexWorkerApi.ts — TypeScript IPC Bridge for Long-Running Rust Media Index Worker (P3)
 *
 * Implements typed Tauri Channel event consumption, candidate checkpoint handling,
 * and post-commit bounded ACK backpressure synchronization.
 */

import { Channel, invoke } from '@tauri-apps/api/core';
import type { DriveFile } from './driveTypes';
import type {
  TgLaneCounts,
  TgLaneDurability,
  TgLaneWatermark,
} from './core/telegramBackend';
import type { MediaIndexState } from '../db/mediaStudioDb';

export type TgMediaIndexJobState =
  | 'preparing'
  | 'running'
  | 'waiting_ack'
  | 'flood_paused'
  | 'user_paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type TgMediaIndexMode = 'historical_backfill' | 'delta_sync';

export type TgMediaIndexAckOutcome = 'committed' | 'failed';

export type TgMediaIndexAckResult =
  | 'accepted'
  | 'already_acked'
  | 'stale'
  | 'unexpected'
  | 'job_terminal';

export interface TgMediaIndexMetricsSnapshot {
  pagesFetched: number;
  rpcCalls: number;
  rowsEmitted: number;
  rowsCommitted: number;
  uniqueMediaPerSec: number;
  rpcPerSec: number;
  rpcEwmaMs: number;
  rpcP95Ms: number;
  floodCount: number;
  floodSecondsTotal: number;
  ackLatencyEwmaMs: number;
  ackLatencyP95Ms: number;
  candidateTotalEstimate?: number | null;
  estimatedPercent?: number | null;
  estimatedEtaSecs?: number | null;
}

export interface TgMediaIndexCheckpointCandidate {
  accountId: string;
  peerId: string;
  scopeKind: string;
  topicIdNormalized: number;
  mode: string;
  pvCommittedOffset: number;
  docCommittedOffset: number;
  pvCommittedExhausted: boolean;
  docCommittedExhausted: boolean;
  backfillComplete: boolean;
  newestCommittedId?: number | null;
  deltaActive: boolean;
  deltaBaseId: number;
  deltaPvCommittedOffset: number;
  deltaDocCommittedOffset: number;
  deltaPvCommittedExhausted: boolean;
  deltaDocCommittedExhausted: boolean;
  deltaComplete: boolean;
}

export interface TgMediaIndexPageEvent {
  jobId: number;
  ackId: number;
  mode: TgMediaIndexMode;
  rows: DriveFile[];
  candidateCheckpoint: TgMediaIndexCheckpointCandidate;
  laneCounts?: TgLaneCounts | null;
  emittedWatermark?: TgLaneWatermark | null;
  laneDurability?: TgLaneDurability | null;
  hasMore: boolean;
  metrics: TgMediaIndexMetricsSnapshot;
}

export interface TgMediaIndexProgressEvent {
  jobId: number;
  state: TgMediaIndexJobState;
  mode: TgMediaIndexMode;
  metrics: TgMediaIndexMetricsSnapshot;
}

export interface TgMediaIndexCompleteEvent {
  jobId: number;
  mode: TgMediaIndexMode;
  totalEmittedRows: number;
  metrics: TgMediaIndexMetricsSnapshot;
}

export type TgMediaIndexEvent =
  | {
      type: 'state';
      jobId: number;
      state: TgMediaIndexJobState;
    }
  | ({
      type: 'page';
    } & TgMediaIndexPageEvent)
  | ({
      type: 'progress';
    } & TgMediaIndexProgressEvent)
  | {
      type: 'flood';
      jobId: number;
      waitSecs: number;
      resumeAtMs: number;
    }
  | ({
      type: 'complete';
    } & TgMediaIndexCompleteEvent)
  | {
      type: 'failed';
      jobId: number;
      code: string;
      message: string;
      recoverable: boolean;
    };

export interface TgMediaIndexPageAck {
  jobId: number;
  ackId: number;
  outcome: TgMediaIndexAckOutcome;
  committedState?: MediaIndexState | null;
  errorCode?: string | null;
}

export interface TgStartMediaIndexJobRequest {
  clientRequestId: string;
  identity: {
    session: string;
    apiId: number;
    apiHash: string;
  };
  peerId: string;
  topicId?: number | null;
  pageSize?: number | null;
  initialState?: MediaIndexState | null;
  forceMode?: TgMediaIndexMode | null;
}

export interface TgStartMediaIndexJobResponse {
  jobId: number;
  state: TgMediaIndexJobState;
  reusedExistingJob: boolean;
}

export interface TgMediaIndexControlResponse {
  jobId: number;
  accepted: boolean;
  state: TgMediaIndexJobState;
}

export interface TgMediaIndexJobError {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface TgMediaIndexJobStatus {
  jobId: number;
  state: TgMediaIndexJobState;
  mode: TgMediaIndexMode;
  peerSafeLabel: string;
  topicId?: number | null;
  createdAtMs: number;
  startedAtMs?: number | null;
  updatedAtMs: number;
  expectedAckId?: number | null;
  metrics: TgMediaIndexMetricsSnapshot;
  terminalError?: TgMediaIndexJobError | null;
}

/**
 * Starts a new or re-attaches to an existing long-running media index job via Tauri Channel.
 */
export async function startMediaIndexJob(
  request: TgStartMediaIndexJobRequest,
  onEvent: (event: TgMediaIndexEvent) => void
): Promise<TgStartMediaIndexJobResponse> {
  const channel = new Channel<TgMediaIndexEvent>();
  channel.onmessage = onEvent;

  return await invoke<TgStartMediaIndexJobResponse>('tg_start_media_index_job', {
    request,
    onEvent: channel,
  });
}

/**
 * Sends a typed storage ACK to Rust after IndexedDB transaction commit.
 */
export async function ackMediaIndexPage(
  ack: TgMediaIndexPageAck
): Promise<TgMediaIndexAckResult> {
  return await invoke<TgMediaIndexAckResult>('tg_ack_media_index_page', {
    ack,
  });
}

/**
 * Requests the worker to pause before the next Telegram RPC.
 */
export async function pauseMediaIndexJob(
  jobId: number
): Promise<TgMediaIndexControlResponse> {
  return await invoke<TgMediaIndexControlResponse>('tg_pause_media_index_job', {
    jobId,
  });
}

/**
 * Requests the worker to resume execution.
 */
export async function resumeMediaIndexJob(
  jobId: number
): Promise<TgMediaIndexControlResponse> {
  return await invoke<TgMediaIndexControlResponse>('tg_resume_media_index_job', {
    jobId,
  });
}

/**
 * Cancels a running indexing job.
 */
export async function cancelMediaIndexJob(
  jobId: number
): Promise<TgMediaIndexControlResponse> {
  return await invoke<TgMediaIndexControlResponse>('tg_cancel_media_index_job', {
    jobId,
  });
}

/**
 * Queries the current detailed status and bounded metrics of an indexing job.
 */
export async function getMediaIndexJobStatus(
  jobId: number
): Promise<TgMediaIndexJobStatus | null> {
  return await invoke<TgMediaIndexJobStatus | null>('tg_get_media_index_job_status', {
    jobId,
  });
}
