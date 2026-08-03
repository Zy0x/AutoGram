import { spawnDaemonJob, killWorkerJob, parseEventLine, type JobChild } from '../../db/jobProcess';
import { invoke } from '@tauri-apps/api/core';
import { ensureDriveSession, isDriveSessionReady, stopDriveSession, isGhostSessionReady } from '../core/driveSession';
import { detectTauriRuntime } from '../../tauri/platform';
import {
  DRIVE_JOB_ID,
  DRIVE_OPEN_JOB_ID,
  DriveCredentials,
  enqueueDrive,
  baseArgs,
  folderArg,
  runDrive,
  sleep
} from './driveApiUtils';
export async function driveDownload(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  savePath: string
) {
  return runDrive(creds, [
    '--drive-action',
    'download',
    '--message-id',
    String(messageId),
    '--save-path',
    savePath,
    ...folderArg(folderId),
  ]);
}

/**
 * Open/preview download on a dedicated job id so cancel does not kill transfers.
 * Stops warm serve only for this exclusive .session use, then restarts.
 */
export async function driveDownloadOpenSpawn(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  savePath: string,
  handlers: {
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
    onClose?: (code: number | null) => void;
  } = {}
): Promise<JobChild> {
  return enqueueDrive(async () => {
    const hadWarm = isDriveSessionReady();
    if (hadWarm) {
      await stopDriveSession();
      await sleep(200);
    }
    try {
      await killWorkerJob(DRIVE_OPEN_JOB_ID);
    } catch {
      /* ignore */
    }
    let restarted = false;
    const restartWarm = () => {
      if (restarted || !hadWarm) return;
      restarted = true;
      void ensureDriveSession(creds).catch(() => undefined);
    };

    // Grammers-only download (no Telethon daemon).
    if (detectTauriRuntime()) {
      try {
        const { tgDownloadFile } = await import('../core/telegramBackend');
        const chatId = folderId == null ? 'me' : String(folderId);
        const apiId = Number(creds.apiId) || 0;
        const gr = await tgDownloadFile({
          session: creds.session,
          apiId,
          apiHash: creds.apiHash,
          chatId,
          messageId,
          destPath: savePath,
        });
        if (gr?.ok && gr.data?.path) {
          handlers.onStdoutLine?.(
            `[JSON_OUTPUT]${JSON.stringify({ status: 'success', path: gr.data.path, backend: 'grammers' })}`
          );
          try {
            handlers.onClose?.(0);
          } finally {
            restartWarm();
          }
          return { jobId: DRIVE_OPEN_JOB_ID, dispose: () => undefined };
        }
        throw new Error(gr?.userMessage || gr?.error?.message || 'Download Grammers gagal');
      } catch (e) {
        restartWarm();
        throw e;
      }
    }
    restartWarm();
    throw new Error('Download membutuhkan desktop Rust + Grammers.');
  });
}

/** True while exclusive transfer job (upload/download-batch) owns DRIVE_JOB_ID. */
let transferJobActive = false;
let activeTransferLease: { sessionKeyHash: string; transferId: string } | null = null;
let leaseProbeCache: { key: string; active: boolean; at: number } | null = null;
let transferChainNeedsWarmRestart = false;

/** Non-secret deterministic key used only for the in-process/Rust lease map. */
export function driveSessionLeaseKey(creds: DriveCredentials): string {
  const input = `${creds.session}|${creds.apiId}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function isSessionTransferLeased(creds: DriveCredentials): Promise<boolean> {
  if (isGhostSessionReady(creds)) {
    return false;
  }
  if (transferJobActive) return true;
  const key = driveSessionLeaseKey(creds);
  if (activeTransferLease?.sessionKeyHash === key) return true;
  const now = Date.now();
  if (leaseProbeCache?.key === key && now - leaseProbeCache.at < 500) {
    return leaseProbeCache.active;
  }
  if (!detectTauriRuntime()) return false;
  try {
    const lease = await invoke<unknown>('get_worker_session_lease', { sessionKeyHash: key });
    const active = !!lease;
    leaseProbeCache = { key, active, at: now };
    return active;
  } catch {
    return false;
  }
}

async function acquireTransferLease(creds: DriveCredentials, transferId: string): Promise<void> {
  const key = driveSessionLeaseKey(creds);
  if (detectTauriRuntime()) {
    let last: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await invoke('acquire_worker_session_lease', {
          sessionKeyHash: key,
          transferId,
          jobId: DRIVE_JOB_ID,
        });
        last = null;
        break;
      } catch (e) {
        last = e;
        if (attempt < 3) await sleep(120 + attempt * 120);
      }
    }
    if (last) throw last;
  }
  activeTransferLease = { sessionKeyHash: key, transferId };
  leaseProbeCache = { key, active: true, at: Date.now() };
}

async function releaseTransferLease(): Promise<void> {
  const lease = activeTransferLease;
  activeTransferLease = null;
  if (!lease) return;
  try {
    if (detectTauriRuntime()) {
      await invoke('release_worker_session_lease', {
        sessionKeyHash: lease.sessionKeyHash,
        transferId: lease.transferId,
      });
    }
  } catch {
    // Rust also releases leases when the worker process exits.
  } finally {
    leaseProbeCache = { key: lease.sessionKeyHash, active: false, at: Date.now() };
  }
}

export function isTransferJobActive(): boolean {
  return transferJobActive;
}

/**
 * Hold exclusive Telegram session ownership for transfer work (upload/download).
 * Stops warm drive-serve, acquires lease, then runs `fn`. Restarts warm session after.
 * Used by media-studio spawn and Rust studio orchestrator.
 */
export async function withExclusiveTransferSession<T>(
  creds: DriveCredentials,
  transferId: string,
  fn: () => Promise<T>,
  opts?: { skipRestartWarm?: boolean; skipKillWorker?: boolean }
): Promise<T> {
  return enqueueDrive(async () => {
    if (transferJobActive) {
      throw new Error(
        'Transfer lain masih berjalan. Tunggu selesai atau Stop dulu di Transfer Manager.'
      );
    }
    if (!opts?.skipKillWorker) {
      try {
        await killWorkerJob(DRIVE_JOB_ID);
        await sleep(220);
      } catch {
        /* ignore */
      }
    }
    await acquireTransferLease(creds, transferId);
    const hadWarm = isDriveSessionReady();
    transferChainNeedsWarmRestart = transferChainNeedsWarmRestart || hadWarm;
    if (hadWarm) {
      await stopDriveSession();
      await sleep(250);
    }
    let restarted = false;
    const restartWarm = () => {
      if (opts?.skipRestartWarm) return;
      if (restarted || !transferChainNeedsWarmRestart) return;
      restarted = true;
      transferChainNeedsWarmRestart = false;
      setTimeout(() => {
        void ensureDriveSession(creds).catch(() => undefined);
      }, 1200);
    };
    transferJobActive = true;
    try {
      return await fn();
    } finally {
      transferJobActive = false;
      await releaseTransferLease();
      restartWarm();
    }
  });
}

/**
 * Long-running transfer: stop drive-serve first (exclusive .session lock),
 * then spawn worker; restart warm session when job exits.
 * Kill-before-respawn is handled in Rust start_worker_job for same job_id.
 */
async function spawnExclusiveTransfer(
  creds: DriveCredentials,
  args: string[],
  handlers: {
    onStdoutLine: (line: string) => void;
    onStderrLine: (line: string) => void;
    onClose: (code: number | null) => void;
  },
  opts?: { skipRestartWarm?: boolean }
): Promise<JobChild> {
  return enqueueDrive(async () => {
    // Soft mutex: refuse second concurrent exclusive transfer (UI also gates).
    if (transferJobActive) {
      throw new Error(
        'Transfer lain masih berjalan. Tunggu selesai atau Stop dulu di Transfer Manager.'
      );
    }
    // Best-effort: clear any orphan transfer worker before spawn
    try {
      await killWorkerJob(DRIVE_JOB_ID);
      await sleep(220);
    } catch {
      /* ignore */
    }
    const transferId = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await acquireTransferLease(creds, transferId);
    const hadWarm = isDriveSessionReady();
    transferChainNeedsWarmRestart = transferChainNeedsWarmRestart || hadWarm;
    if (hadWarm) {
      await stopDriveSession();
      await sleep(250);
    }
    let restarted = false;
    const restartWarm = () => {
      if (opts?.skipRestartWarm) return;
      if (restarted || !transferChainNeedsWarmRestart) return;
      restarted = true;
      transferChainNeedsWarmRestart = false;
      setTimeout(() => {
        void ensureDriveSession(creds).catch(() => undefined);
      }, 1200);
    };
    transferJobActive = true;
    try {
      return await spawnDaemonJob({
        jobId: DRIVE_JOB_ID,
        args,
        onStdoutLine: handlers.onStdoutLine,
        onStderrLine: handlers.onStderrLine,
        onClose: (code: any) => {
          void (async () => {
            transferJobActive = false;
            await releaseTransferLease();
            try {
              handlers.onClose(code);
            } finally {
              restartWarm();
            }
          })();
        },
        allowShellFallback: false,
      });
    } catch (e) {
      transferJobActive = false;
      await releaseTransferLease();
      restartWarm();
      throw e;
    }
  });
}

/** Long-running jobs also go through queue for start, but stay exclusive via job id */
export async function driveUploadSpawn(
  creds: DriveCredentials,
  folderId: number | null,
  filesJsonPath: string,
  optionsJsonPath: string,
  handlers: {
    onStdoutLine: (line: string) => void;
    onStderrLine: (line: string) => void;
    onClose: (code: number | null) => void;
  },
  opts?: { skipRestartWarm?: boolean }
): Promise<JobChild> {
  return spawnExclusiveTransfer(
    creds,
    [
      ...baseArgs(creds),
      '--drive-action',
      'upload',
      ...folderArg(folderId),
      '--files-json',
      filesJsonPath,
      '--options-json',
      optionsJsonPath,
    ],
    handlers,
    opts
  );
}

export async function driveDownloadBatchSpawn(
  creds: DriveCredentials,
  folderId: number | null,
  messageIdsJsonPath: string,
  saveDir: string,
  optionsJsonPath: string,
  handlers: {
    onStdoutLine: (line: string) => void;
    onStderrLine: (line: string) => void;
    onClose: (code: number | null) => void;
  },
  opts?: { skipRestartWarm?: boolean }
): Promise<JobChild> {
  return spawnExclusiveTransfer(
    creds,
    [
      ...baseArgs(creds),
      '--drive-action',
      'download-batch',
      ...folderArg(folderId),
      '--save-path',
      saveDir,
      '--message-ids-json',
      messageIdsJsonPath,
      '--options-json',
      optionsJsonPath,
    ],
    handlers,
    opts
  );
}

export async function cancelDriveJob(transferId?: string): Promise<boolean> {
  transferJobActive = false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('studio_cancel_transfer', { transferId: transferId ?? null });
  } catch {
    /* ignore */
  }
  return killWorkerJob(DRIVE_JOB_ID);
}

/** Cancel open/preview download only — never touches transfer job. */
export async function cancelDriveOpenJob(): Promise<boolean> {
  return killWorkerJob(DRIVE_OPEN_JOB_ID);
}

/**
 * Delete incomplete download artifacts (dest + `.part`) after Stop.
 * Merges explicit paths with worker registry of in-progress downloads.
 */
export async function cleanupPartialDownloads(
  paths?: string[]
): Promise<{ deleted: string[]; failed: string[]; count: number }> {
  try {
    const { invoke, isTauri } = await import('@tauri-apps/api/core');
    if (!isTauri()) {
      return { deleted: [], failed: [], count: 0 };
    }
    const res = await invoke<{
      deleted?: string[];
      failed?: string[];
      count?: number;
    }>('cleanup_partial_downloads', {
      paths: paths && paths.length ? paths : null,
    });
    return {
      deleted: res?.deleted || [],
      failed: res?.failed || [],
      count: Number(res?.count || 0),
    };
  } catch (e) {
    console.warn('cleanupPartialDownloads failed', e);
    return { deleted: [], failed: [String(e)], count: 0 };
  }
}

/** Soft-pause flag under worker/temp (worker checks between files). */
const PAUSE_FLAG_NAME = 'drive_pause.txt';

export async function setDriveTransferPaused(paused: boolean): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  if (paused) {
    try {
      await invoke<string>('write_worker_temp_file', {
        filename: PAUSE_FLAG_NAME,
        contents: '1',
      });
    } catch (e) {
      console.warn('setDriveTransferPaused write failed', e);
    }
  } else {
    try {
      // Resolve path then delete — write first to get path if missing is ok
      const path = await invoke<string>('write_worker_temp_file', {
        filename: PAUSE_FLAG_NAME,
        contents: '0',
      });
      await invoke('delete_worker_temp_file', { path });
    } catch {
      /* ignore — flag may already be gone */
    }
  }
}

export async function clearDriveTransferPause(): Promise<void> {
  return setDriveTransferPaused(false);
}

/**
 * Single-file download with live stdout events (progress).
 * Prefer this over run-once `driveDownload` for UI progress.
 */
export async function driveDownloadSpawn(
  creds: DriveCredentials,
  messageId: number,
  folderId: number | null,
  savePath: string,
  handlers: {
    onStdoutLine: (line: string) => void;
    onStderrLine: (line: string) => void;
    onClose: (code: number | null) => void;
  },
  opts?: { skipRestartWarm?: boolean }
): Promise<JobChild> {
  return spawnExclusiveTransfer(
    creds,
    [
      ...baseArgs(creds),
      '--drive-action',
      'download',
      '--message-id',
      String(messageId),
      '--save-path',
      savePath,
      ...folderArg(folderId),
    ],
    handlers,
    opts
  );
}

export { parseEventLine };

