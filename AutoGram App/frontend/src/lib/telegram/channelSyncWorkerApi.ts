/**
 * channelSyncWorkerApi.ts — TypeScript IPC Bridge for Rust Channel Synchronization Subsystem (P2.5)
 *
 * Provides typed Tauri Channel streaming, mutation batch handling,
 * and post-commit bounded Storage ACK backpressure synchronization with IndexedDB.
 */

import { Channel, invoke } from '@tauri-apps/api/core';
import type { MediaMutation } from '../db/mediaStudioDb';

export interface TgTelegramIdentity {
  session: string;
  apiId: number | string;
  apiHash: string;
}

export type ChannelSyncStatus =
  | 'preparing'
  | 'bootstrapping'
  | 'live_synced'
  | 'gap_grace'
  | 'recovering_difference'
  | 'waiting_ack'
  | 'waiting_frontend'
  | 'reconcile_required'
  | 'reconciling'
  | 'paused'
  | 'stopped'
  | 'failed';

export type ChannelMutationSource =
  | 'bootstrap'
  | 'passive'
  | 'difference'
  | 'difference_empty';

export type ChannelSyncAckOutcome = 'committed' | 'failed';

export type ChannelSyncAckResult =
  | 'accepted'
  | 'already_acked'
  | 'stale'
  | 'unexpected'
  | 'sync_terminal';

export interface ChannelSyncMutationBatchEvent {
  syncId: number;
  batchId: number;
  accountId: string;
  peerId: string;
  previousPts: number;
  candidatePts: number;
  source: ChannelMutationSource;
  mutations: MediaMutation[];
  isFinal: boolean;
}

export type ChannelSyncEvent =
  | { type: 'state'; syncId: number; state: ChannelSyncStatus }
  | ({ type: 'batch' } & ChannelSyncMutationBatchEvent)
  | {
      type: 'gap_detected';
      syncId: number;
      localPts: number;
      incomingPts: number;
      ptsCount: number;
    }
  | {
      type: 'reconcile_required';
      syncId: number;
      latestPts: number;
      reason: string;
    }
  | {
      type: 'failed';
      syncId: number;
      code: string;
      message: string;
      recoverable: boolean;
    };

export interface StartChannelSyncRequest {
  clientRequestId: string;
  identity: TgTelegramIdentity;
  peerId: string;
  initialPts?: number | null;
  isActivelyViewed?: boolean | null;
}

export interface StartChannelSyncResponse {
  syncId: number;
  state: ChannelSyncStatus;
  reusedExistingSync: boolean;
  subscriberId: number;
  generation: number;
  currentPts: number;
}

export interface AttachChannelSyncResponse {
  syncId: number;
  attached: boolean;
  subscriberId: number;
  generation: number;
  state: ChannelSyncStatus;
  currentPts: number;
  replayedBatchId?: number | null;
}

export interface DetachChannelSyncResponse {
  syncId: number;
  detached: boolean;
}

export interface ChannelSyncControlResponse {
  syncId: number;
  accepted: boolean;
  state: ChannelSyncStatus;
}

export interface ChannelSyncAck {
  syncId: number;
  batchId: number;
  outcome: ChannelSyncAckOutcome;
  committedPts?: number | null;
  errorCode?: string | null;
}

/**
 * Starts or attaches to a channel synchronization stream on the Rust core.
 */
export async function startChannelSync(
  request: StartChannelSyncRequest,
  onEvent: (event: ChannelSyncEvent) => void
): Promise<StartChannelSyncResponse> {
  const channel = new Channel<ChannelSyncEvent>();
  channel.onmessage = (event) => {
    try {
      onEvent(event);
    } catch (err) {
      console.error('[ChannelSyncApi] Event callback error:', err);
    }
  };

  const rawApiId = request.identity?.apiId;
  const parsedApiId =
    typeof rawApiId === 'string'
      ? parseInt(rawApiId, 10) || 0
      : Number(rawApiId || 0);

  const normalizedRequest = {
    ...request,
    identity: {
      ...request.identity,
      apiId: parsedApiId,
    },
  };

  return invoke<StartChannelSyncResponse>('tg_start_channel_sync', {
    request: normalizedRequest,
    onEvent: channel,
  });
}

/**
 * Attaches a replacement primary persistence Channel to an existing active worker.
 */
export async function attachChannelSync(
  syncId: number,
  onEvent: (event: ChannelSyncEvent) => void
): Promise<AttachChannelSyncResponse> {
  const channel = new Channel<ChannelSyncEvent>();
  channel.onmessage = (event) => {
    try {
      onEvent(event);
    } catch (err) {
      console.error('[ChannelSyncApi] Attach event callback error:', err);
    }
  };

  return invoke<AttachChannelSyncResponse>('tg_attach_channel_sync', {
    syncId,
    onEvent: channel,
  });
}

/**
 * Explicitly detaches a persistence subscriber from a channel worker.
 */
export async function detachChannelSync(
  syncId: number,
  subscriberId: number,
  generation: number
): Promise<DetachChannelSyncResponse> {
  return invoke<DetachChannelSyncResponse>('tg_detach_channel_sync', {
    syncId,
    subscriberId,
    generation,
  });
}

/**
 * Sends a storage ACK to Rust after IndexedDB transaction commit.
 */
export async function ackChannelSyncBatch(
  ack: ChannelSyncAck
): Promise<ChannelSyncAckResult> {
  return invoke<ChannelSyncAckResult>('tg_ack_channel_sync_batch', { ack });
}

/**
 * Helper to construct and dispatch a storage ACK safely.
 */
export async function sendChannelSyncStorageAck(
  syncId: number,
  batchId: number,
  outcome: ChannelSyncAckOutcome,
  committedPts?: number,
  errorCode?: string
): Promise<ChannelSyncAckResult> {
  return ackChannelSyncBatch({
    syncId,
    batchId,
    outcome,
    committedPts: committedPts ?? null,
    errorCode: errorCode ?? null,
  });
}

/**
 * Controls whether the channel is actively viewed in the foreground (for short polling).
 */
export async function setChannelSyncActiveView(
  syncId: number,
  isActive: boolean
): Promise<void> {
  return invoke<void>('tg_set_channel_sync_active_view', {
    syncId,
    isActive,
  });
}

/**
 * Pauses an active channel synchronization stream.
 */
export async function pauseChannelSync(
  syncId: number
): Promise<ChannelSyncControlResponse> {
  return invoke<ChannelSyncControlResponse>('tg_pause_channel_sync', { syncId });
}

/**
 * Resumes a paused channel synchronization stream.
 */
export async function resumeChannelSync(
  syncId: number
): Promise<ChannelSyncControlResponse> {
  return invoke<ChannelSyncControlResponse>('tg_resume_channel_sync', { syncId });
}

/**
 * Stops and terminates a channel synchronization stream.
 */
export async function stopChannelSync(
  syncId: number
): Promise<ChannelSyncControlResponse> {
  return invoke<ChannelSyncControlResponse>('tg_stop_channel_sync', { syncId });
}

/**
 * Completes authoritative reconciliation for a channel sync worker and advances current PTS in Rust.
 */
export async function completeChannelSyncReconcile(
  syncId: number,
  latestPts: number
): Promise<boolean> {
  return invoke<boolean>('tg_complete_channel_sync_reconcile', {
    syncId,
    latestPts,
  });
}
