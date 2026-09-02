/**
 * Studio orchestrator (Rust queue + Grammers MTProto).
 */
import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../tauri/platform';
import type { DriveCredentials } from '../driveApi';
import { withExclusiveTransferSession } from '../driveApi';
import { resolveDriveEngineLocation } from '../driveApi/driveEngineApi';

export type QueueItemState =
  | 'pending'
  | 'preparing'
  | 'uploading'
  | 'committing'
  | 'unknown_commit'
  | 'reconciling'
  | 'done'
  | 'failed'
  | 'skipped';

export type TransferRecord = {
  transferId: string;
  session: string;
  apiId: number;
  chatId: string;
  topicId?: number | null;
  state: string;
  items: Array<{
    index: number;
    path: string;
    caption: string;
    size: number;
    state: QueueItemState;
    messageId?: number | null;
    error?: string | null;
    itemId: string;
  }>;
  options: Record<string, unknown>;
  createdAtMs: number;
  updatedAtMs: number;
  doneCount: number;
  failedCount: number;
  logs?: Array<{
    timestampMs: number;
    level: string;
    operation: string;
    message: string;
  }>;
};

export type StudioRunResult = {
  transferId: string;
  mode: string;
  items: number;
  message: string;
};

export type StudioOrchRequest = {
  session: string;
  apiId: number;
  apiHash: string;
  chatId: string;
  topicId?: number | null;
  files: Array<{ path: string; caption?: string; size?: number }>;
  options?: Record<string, unknown>;
  transferId?: string;
};

export type StudioOrchUploadOutcome = {
  result: StudioRunResult;
  record: TransferRecord | null;
  mode: 'rust_orch';
};

/** Local filesystem path (not http/https remote URL). */
export function isLocalUploadPath(path: string): boolean {
  const p = String(path || '').trim();
  if (!p) return false;
  if (/^https?:\/\//i.test(p)) return false;
  return p.includes('\\') || p.includes('/') || /^[a-zA-Z]:/.test(p);
}

/** Local path or http(s) remote URL (Rust downloads remote before Grammers upload). */
export function isStudioUploadPath(path: string): boolean {
  const p = String(path || '').trim();
  if (!p) return false;
  if (/^https?:\/\//i.test(p)) return true;
  return isLocalUploadPath(p);
}

/**
 * Eligible for Rust + Grammers orchestrator (only path on desktop).
 * Local files + remote http(s) URLs; albums of any size are chunked (≤10).
 */
export function isStudioOrchEligible(
  paths: string[],
  _options?: Record<string, unknown> | null
): boolean {
  if (!detectTauriRuntime()) return false;
  if (!paths.length) return false;
  return paths.every(isStudioUploadPath);
}

/** Map Drive folder peer to studio chat_id ("me" = Saved Messages). */
export function studioChatIdFromFolder(folderId: number | string | null | undefined): string {
  if (folderId == null) return 'me';
  const numericId = Number(folderId);
  const engineLocation = Number.isFinite(numericId)
    ? resolveDriveEngineLocation(numericId)
    : null;
  return String(engineLocation?.storagePeerId ?? folderId);
}

export async function studioEnqueue(request: StudioOrchRequest): Promise<TransferRecord | null> {
  if (!detectTauriRuntime()) return null;
  try {
    return await invoke<TransferRecord>('studio_enqueue', { request });
  } catch {
    return null;
  }
}

export async function studioListTransfers(): Promise<TransferRecord[]> {
  if (!detectTauriRuntime()) return [];
  try {
    return await invoke<TransferRecord[]>('studio_list_transfers');
  } catch {
    return [];
  }
}

export async function studioGetTransfer(transferId: string): Promise<TransferRecord | null> {
  if (!detectTauriRuntime()) return null;
  try {
    return await invoke<TransferRecord | null>('studio_get_transfer', { transferId });
  } catch {
    return null;
  }
}

export async function studioDismissTransfer(transferId: string): Promise<boolean> {
  if (!detectTauriRuntime() || !transferId) return false;
  try {
    return await invoke<boolean>('studio_dismiss_transfer', { transferId });
  } catch {
    return false;
  }
}

export async function studioClearTransfers(session?: string | null): Promise<number> {
  if (!detectTauriRuntime()) return 0;
  try {
    return await invoke<number>('studio_clear_transfers', { session: session ?? null });
  } catch {
    return 0;
  }
}

/**
 * Run Rust + Grammers orchestrated upload. Throws on failure (no Telethon fallback).
 */
export async function studioRunOrchestrated(
  request: StudioOrchRequest
): Promise<StudioRunResult> {
  if (!detectTauriRuntime()) {
    throw new Error('Studio upload membutuhkan aplikasi desktop (Rust + Grammers).');
  }
  const { debugLogLayer } = await import('../../utils/debugMode');
  debugLogLayer('rust', 'studioOrch', 'run_start', {
    files: request.files?.length,
    chatId: request.chatId,
    transferId: request.transferId,
  });
  const r = await invoke<StudioRunResult>('studio_run_orchestrated', { request });
  debugLogLayer('rust', 'studioOrch', 'run_ok', r);
  return r;
}

/**
 * Default upload path: exclusive session + Grammers orchestrator only.
 * Throws if Grammers fails — no media-studio / Telethon spawn.
 */
export async function studioRunUploadDefault(
  creds: DriveCredentials,
  request: StudioOrchRequest,
  opts?: { skipRestartWarm?: boolean }
): Promise<StudioOrchUploadOutcome> {
  if (!detectTauriRuntime()) {
    throw new Error('Studio upload membutuhkan aplikasi desktop (Rust + Grammers).');
  }
  if (!request.files.length) {
    throw new Error('Tidak ada file untuk diunggah.');
  }
  if (!request.files.every((f) => isStudioUploadPath(f.path))) {
    throw new Error('Path unggahan tidak valid (butuh file lokal atau URL http/https).');
  }

  const transferId =
    request.transferId ||
    `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fullReq: StudioOrchRequest = { ...request, transferId };

  try {
    const result = await withExclusiveTransferSession(
      creds,
      transferId,
      async () => studioRunOrchestrated(fullReq),
      { skipRestartWarm: opts?.skipRestartWarm, skipKillWorker: true }
    );
    const record = await studioGetTransfer(result.transferId);
    return { result, record, mode: 'rust_orch' };
  } catch (e) {
    console.error('[studioOrch] Grammers upload failed (no Telethon fallback)', e);
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Normalize orch item state to transfer UI status. */
export function mapOrchItemStatus(
  state: QueueItemState | string | undefined
): 'done' | 'failed' | 'skipped' | 'uploading' {
  const s = String(state || '').toLowerCase();
  if (s === 'done' || s === 'success') return 'done';
  if (s === 'skipped') return 'skipped';
  if (s === 'failed') return 'failed';
  return 'uploading';
}
