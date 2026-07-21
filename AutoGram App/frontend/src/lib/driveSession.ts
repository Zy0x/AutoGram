/**
 * Persistent Drive worker session — one Telethon connection for the Media Studio tab.
 * Avoids multi-second reconnect cost on every list/thumb call.
 * Supports Ghost Session mode for concurrent media preview & streaming during uploads.
 */
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { spawnDaemonJob, killWorkerJob, type JobChild } from './jobProcess';
import type { DriveCredentials } from './driveApi';
import { detectTauriRuntime } from './platform';
import { isDebugMode } from './debugMode';

export const DRIVE_SERVE_JOB_ID_BASE = 991000;
export const DRIVE_SERVE_JOB_ID = 991003;
export const API_SERVER_JOB_ID = 991005;

let activeJobId = DRIVE_SERVE_JOB_ID;


type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let child: JobChild | null = null;
let apiChild: JobChild | null = null;
let ready = false;
let starting: Promise<void> | null = null;
let unsub: UnlistenFn | null = null;
let unsubExit: UnlistenFn | null = null;
let reqSeq = 0;
const pending = new Map<string, Pending>();
let activeCredsKey = '';
let scheduledStop: ReturnType<typeof setTimeout> | null = null;
let sessionGeneration = 0;
let readyAt = 0;

// GHOST SESSION STATES
let mode: 'main' | 'ghost' | 'ghost-starting' = 'main';
let activePreviews = 0;
let ghostReady = false;
let ghostTimer: ReturnType<typeof setTimeout> | null = null;
const GHOST_GRACE_MS = 30000;

function credKey(c: DriveCredentials) {
  return `${c.session}|${c.apiId}`;
}

/**
 * Mirror the non-secret lease key used by driveApi/Rust without importing the
 * runtime driveApi module (driveApi already imports this module). Keeping this
 * guard at the session boundary also protects direct ensureDriveSession callers.
 */
function sessionLeaseKey(creds: DriveCredentials): string {
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

async function hasTransferLease(creds: DriveCredentials): Promise<boolean> {
  if (!detectTauriRuntime()) return false;
  try {
    return !!(await invoke('get_worker_session_lease', {
      sessionKeyHash: sessionLeaseKey(creds),
    }));
  } catch {
    // Older/non-Tauri runtimes do not expose the lease command.
    return false;
  }
}

/**
 * A ready worker is only useful when it belongs to the requested Telegram
 * session.  Treating a worker from another session as ready can leak dialog
 * folders, peers, and Saved Messages between accounts during a rapid switch.
 */
export function isDriveSessionReadyFor(creds: DriveCredentials | null | undefined) {
  return !!creds && ready && activeCredsKey === credKey(creds);
}

type DriveEventListener = (event: { type: string; [k: string]: any }) => void;
const listeners = new Set<DriveEventListener>();

// Worker logging buffer for diagnostics (circular)
const workerLog: string[] = [];
let workerLogFlushTimer: number | null = null;
function pushWorkerLog(line: string) {
  if (!isDebugMode()) {
    if (workerLog.length > 0) {
      workerLog.length = 0;
    }
    return;
  }
  try {
    const ts = new Date().toISOString();
    workerLog.push(`${ts} ${String(line || '')}`);
    if (workerLog.length > 5000) workerLog.shift();
    if (workerLogFlushTimer == null) {
      workerLogFlushTimer = window.setTimeout(flushWorkerLogToFile, 10000); // 10s throttle in debug mode
    }
  } catch {
    /* ignore */
  }
}

async function flushWorkerLogToFile() {
  try {
    if (workerLogFlushTimer != null) {
      clearTimeout(workerLogFlushTimer);
      workerLogFlushTimer = null;
    }
    if (!isDebugMode()) {
      workerLog.length = 0;
      return;
    }
    if (!workerLog.length) return;
    const contents = workerLog.join('\n') + '\n';
    // Attempt to write to AppLocalData/AutoGram/drive-worker.log
    try {
      await writeTextFile('AutoGram/drive-worker.log', contents, {
        baseDir: BaseDirectory.AppLocalData,
      });
    } catch (e) {
      // best-effort: ignore write failures
      console.warn('[drive-serve] failed to write worker log:', e);
    }
  } catch {
    /* ignore */
  }
}

export function addDriveEventListener(l: DriveEventListener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function settleLine(line: string) {
  const text = String(line || '').trim();
  if (!text.startsWith('{')) return;
  try {
    const msg = JSON.parse(text);
    if (msg.type === 'ready') {
      ready = true;
      readyAt = Date.now();
      return;
    }
    if (
      msg.type === 'index_progress' ||
      msg.type === 'index_complete' ||
      msg.type === 'update' ||
      msg.type === 'pts_update'
    ) {
      listeners.forEach((l) => l(msg));
      return;
    }
    const id = msg.id != null ? String(msg.id) : '';
    if (!id || !pending.has(id)) return;
    const p = pending.get(id)!;
    pending.delete(id);
    clearTimeout(p.timer);
    if (msg.ok === false) {
      p.reject(new Error(msg.error || 'Drive serve error'));
    } else {
      p.resolve(msg.result);
    }
  } catch {
    /* ignore non-json */
  }
}

async function writeStdin(line: string) {
  if (!detectTauriRuntime()) throw new Error('drive-serve requires desktop app');
  await invoke('write_worker_stdin', { jobId: activeJobId, line });
}

export function isDriveSessionReady() {
  return ready;
}

// GHOST SESSION LIFECYCLE MANAGEMENT

export function registerPreviewOpen(creds: DriveCredentials): void {
  const key = credKey(creds);
  if (activeCredsKey !== key) return;
  activePreviews++;
  cancelGhostTransition();
}

export function registerPreviewClose(creds: DriveCredentials): void {
  const key = credKey(creds);
  if (activeCredsKey !== key) return;
  activePreviews = Math.max(0, activePreviews - 1);
  if (activePreviews === 0 && mode === 'ghost') {
    scheduleGhostToMainTransition(creds);
  }
}

export function isGhostSessionReady(creds: DriveCredentials): boolean {
  const key = credKey(creds);
  return activeCredsKey === key && mode === 'ghost' && ghostReady;
}

export function isPreviewActive(): boolean {
  return mode === 'ghost' || mode === 'ghost-starting' || activePreviews > 0;
}

function scheduleGhostToMainTransition(creds: DriveCredentials): void {
  cancelGhostTransition();
  ghostTimer = setTimeout(async () => {
    if (activePreviews > 0 || mode !== 'ghost') return;
    try {
      await invoke('cleanup_ghost_session', { sessionName: creds.session });
    } catch (e) {
      console.warn('[GhostSession] Cleanup failed:', e);
    }
    // Re-spawn main session
    await spawnMainSession(creds);
  }, GHOST_GRACE_MS);
}

function cancelGhostTransition(): void {
  if (ghostTimer) {
    clearTimeout(ghostTimer);
    ghostTimer = null;
  }
}

async function spawnGhostSession(creds: DriveCredentials): Promise<boolean> {
  if (!detectTauriRuntime()) return false;
  const key = credKey(creds);
  try {
    mode = 'ghost-starting';
    ghostReady = false;
    activeJobId = DRIVE_SERVE_JOB_ID;

    // 1. Clone session via Rust (with automatic pause flag)
    await invoke('ensure_ghost_session', { sessionName: creds.session });

    // 2. Stop main session
    await stopDriveSession();
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    // 3. Spawn drive-serve with ghost session (_preview)
    const generation = ++sessionGeneration;
    activeCredsKey = key;
    ready = false;
    const settleCurrentLine = (line: string) => {
      if (generation === sessionGeneration) settleLine(line);
    };

    const unsubs: UnlistenFn[] = [];
    let processAssigned = false;
    let startupReject: ((err: Error) => void) | null = null;
    let onReadyCheck: ReturnType<typeof setInterval> | null = null;
    let t: ReturnType<typeof setTimeout> | null = null;

    const cleanStartupTimers = () => {
      if (onReadyCheck) {
        clearInterval(onReadyCheck);
        onReadyCheck = null;
      }
      if (t) {
        clearTimeout(t);
        t = null;
      }
    };

    unsub = await listen<{ jobId: number; line: string; stream: string }>('worker-line', (ev) => {
      const p = ev.payload as any;
      const jid = p?.jobId ?? p?.job_id;
      if (Number(jid) !== DRIVE_SERVE_JOB_ID) return;
      if (generation !== sessionGeneration) return;
      try {
        pushWorkerLog(`[ghost ${String(p.stream || '')}] ${String(p.line || '')}`);
      } catch {
        /* ignore */
      }
      if (p.stream === 'stderr') {
        console.warn('[drive-serve-ghost]', p.line);
      } else {
        settleCurrentLine(p.line);
      }
    });
    unsubs.push(unsub);

    unsubExit = await listen<{ jobId: number; code: number }>('worker-exit', (ev) => {
      const p = ev.payload as any;
      const jid = p?.jobId ?? p?.job_id;
      if (Number(jid) !== DRIVE_SERVE_JOB_ID) return;
      if (generation !== sessionGeneration) return;
      if (!processAssigned) return;
      const markEnded = () => {
        if (generation !== sessionGeneration) return;
        ready = false;
        child = null;
        for (const [, pend] of pending) {
          clearTimeout(pend.timer);
          const err = new Error('Drive session ended');
          (err as any).code = 'DRIVE_SESSION_ENDED';
          pend.reject(err);
        }
        pending.clear();
      };
      if (!ready) {
        cleanStartupTimers();
        if (startupReject) {
          startupReject(new Error(`Drive session process exited during startup with code ${p.code}`));
        }
        return;
      }
      // Log abnormal exits for diagnostics
      if (p.code !== 0) {
        console.error('[drive-serve] Worker exited with code', p.code, 'generation', generation, 'activeCredsKey', activeCredsKey);
      } else {
        console.warn('[drive-serve] Worker exited gracefully (code 0) post-startup', { code: p.code, generation, activeCredsKey });
      }
      try {
        pushWorkerLog(`[worker-exit] code=${p.code} generation=${generation} activeCreds=${activeCredsKey}`);
        void flushWorkerLogToFile();
      } catch {
        /* ignore */
      }
      if (Date.now() - readyAt < 5_000) {
        return;
      }
      void driveSessionCall('ping', {}, 1500).catch(markEnded);
    });
    unsubs.push(unsubExit);

    await new Promise<void>((resolve, reject) => {
      startupReject = reject;
      t = setTimeout(() => {
        cleanStartupTimers();
        reject(new Error('Ghost drive session start timeout'));
      }, 20000);
      onReadyCheck = setInterval(() => {
        if (ready && processAssigned) {
          cleanStartupTimers();
          resolve();
        }
      }, 40);

      spawnDaemonJob({
        jobId: DRIVE_SERVE_JOB_ID,
        args: [
          '--action',
          'drive-serve',
          '--session',
          `${creds.session}_preview`,
          '--api-id',
          String(creds.apiId),
          '--api-hash',
          String(creds.apiHash),
        ],
        pipeStdin: true,
        allowShellFallback: false,
        onStdoutLine: (line) => settleCurrentLine(line),
        onStderrLine: (line) => console.warn('[drive-serve-ghost]', line),
        onClose: () => undefined,
      })
        .then((c) => {
          child = {
            ...c,
            dispose: () => {
              unsubs.forEach((u) => {
                try {
                  u();
                } catch {
                  /* ignore */
                }
              });
              c.dispose?.();
            },
          };
          processAssigned = true;
        })
        .catch((e) => {
          if (onReadyCheck) clearInterval(onReadyCheck);
          if (t) clearTimeout(t);
          reject(e);
        });
    });

    mode = 'ghost';
    ghostReady = true;
    return true;
  } catch (err) {
    console.error('[GhostSession] Failed to spawn ghost:', err);
    mode = 'main';
    ghostReady = false;
    return await spawnMainSession(creds);
  }
}

async function spawnApiServer(creds: DriveCredentials): Promise<void> {
  if (!detectTauriRuntime()) return;
  try {
    await killWorkerJob(API_SERVER_JOB_ID);
  } catch {
    /* ignore */
  }
  console.log('[API-SERVER] Spawning FastAPI server on port 8550...');
  try {
    const c = await spawnDaemonJob({
      jobId: API_SERVER_JOB_ID,
      args: [
        '--action',
        'api-server',
        '--port',
        '8550',
        '--session',
        creds.session,
        '--api-id',
        String(creds.apiId),
        '--api-hash',
        String(creds.apiHash),
      ],
      allowShellFallback: false,
      onStdoutLine: (line) => console.log('[API-SERVER stdout]', line),
      onStderrLine: (line) => console.warn('[API-SERVER stderr]', line),
      onClose: () => {
        apiChild = null;
        console.log('[API-SERVER] FastAPI server stopped.');
      },
    });
    apiChild = c;
  } catch (err) {
    console.error('[API-SERVER] Failed to spawn FastAPI server:', err);
  }
}

async function spawnMainSession(creds: DriveCredentials): Promise<boolean> {
  if (!detectTauriRuntime()) return false;
  const key = credKey(creds);
  try {
    mode = 'main';
    ghostReady = false;

    await stopDriveSession();
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    const generation = ++sessionGeneration;
    activeJobId = DRIVE_SERVE_JOB_ID_BASE + (generation % 1000);
    const currentActiveJobId = activeJobId;
    activeCredsKey = key;
    ready = false;
    const settleCurrentLine = (line: string) => {
      if (generation === sessionGeneration) settleLine(line);
    };

    const unsubs: UnlistenFn[] = [];
    let processAssigned = false;
    let startupReject: ((err: Error) => void) | null = null;
    let onReadyCheck: ReturnType<typeof setInterval> | null = null;
    let t: ReturnType<typeof setTimeout> | null = null;

    const cleanStartupTimers = () => {
      if (onReadyCheck) {
        clearInterval(onReadyCheck);
        onReadyCheck = null;
      }
      if (t) {
        clearTimeout(t);
        t = null;
      }
    };

    unsub = await listen<{ jobId: number; line: string; stream: string }>('worker-line', (ev) => {
      const p = ev.payload as any;
      const jid = p?.jobId ?? p?.job_id;
      if (Number(jid) !== currentActiveJobId) return;
      if (generation !== sessionGeneration) return;
      try {
        pushWorkerLog(`[main ${String(p.stream || '')}] ${String(p.line || '')}`);
      } catch {
        /* ignore */
      }
      if (p.stream === 'stderr') {
        console.warn('[drive-serve]', p.line);
      } else {
        settleCurrentLine(p.line);
      }
    });
    unsubs.push(unsub);

    unsubExit = await listen<{ jobId: number; code: number }>('worker-exit', (ev) => {
      const p = ev.payload as any;
      const jid = p?.jobId ?? p?.job_id;
      if (Number(jid) !== currentActiveJobId) return;
      if (generation !== sessionGeneration) return;
      if (!processAssigned) return;
      const markEnded = () => {
        if (generation !== sessionGeneration) return;
        ready = false;
        child = null;
        for (const [, pend] of pending) {
          clearTimeout(pend.timer);
          const err = new Error('Drive session ended');
          (err as any).code = 'DRIVE_SESSION_ENDED';
          pend.reject(err);
        }
        pending.clear();
      };
      if (!ready) {
        cleanStartupTimers();
        if (startupReject) {
          startupReject(new Error(`Drive session process exited during startup with code ${p.code}`));
        }
        return;
      }
      if (Date.now() - readyAt < 5_000) {
        return;
      }
      void driveSessionCall('ping', {}, 1500).catch(markEnded);
    });
    unsubs.push(unsubExit);

    await new Promise<void>((resolve, reject) => {
      startupReject = reject;
      t = setTimeout(() => {
        cleanStartupTimers();
        reject(new Error('Drive session start timeout'));
      }, 20000);
      onReadyCheck = setInterval(() => {
        if (ready && processAssigned) {
          cleanStartupTimers();
          resolve();
        }
      }, 40);

      spawnDaemonJob({
        jobId: currentActiveJobId,
        args: [
          '--action',
          'drive-serve',
          '--session',
          creds.session,
          '--api-id',
          String(creds.apiId),
          '--api-hash',
          String(creds.apiHash),
        ],
        pipeStdin: true,
        allowShellFallback: false,
        onStdoutLine: (line) => settleCurrentLine(line),
        onStderrLine: (line) => console.warn('[drive-serve]', line),
        onClose: () => undefined,
      })
        .then((c) => {
          child = {
            ...c,
            dispose: () => {
              unsubs.forEach((u) => {
                try {
                  u();
                } catch {
                  /* ignore */
                }
              });
              c.dispose?.();
            },
          };
          processAssigned = true;
        })
        .catch((e) => {
          if (onReadyCheck) clearInterval(onReadyCheck);
          if (t) clearTimeout(t);
          reject(e);
        });
    });

    // Spawn FastAPI api-server alongside main session
    void spawnApiServer(creds);

    return true;
  } catch (e) {
    console.warn('[drive-serve] spawn main failed', e);
    if (activeCredsKey === key) {
      ready = false;
      child = null;
    }
    return false;
  }
}

/**
 * Start warm drive-serve if possible.
 * Supports spawning Ghost session if needPreview is true (bypassing transfer leases).
 */
export async function ensureDriveSession(
  creds: DriveCredentials,
  needPreview: boolean = false
): Promise<boolean> {
  cancelScheduledDriveSessionStop();


  if (!needPreview) {
    // Normal mode: check lease
    if (await hasTransferLease(creds)) return false;
    if (mode === 'main' && isDriveSessionReadyFor(creds)) return true;
  } else {
    // Ghost mode: bypass lease, reuse if ghost already ready
    if (mode === 'ghost' && isDriveSessionReadyFor(creds) && ghostReady) {
      cancelGhostTransition();
      return true;
    }
  }

  // Wait for any in-flight startup to settle
  while (starting) {
    const inFlight = starting;
    try {
      await inFlight;
    } catch {
      // ignore
    }
    if (!needPreview && mode === 'main' && isDriveSessionReadyFor(creds)) return true;
    if (needPreview && mode === 'ghost' && isDriveSessionReadyFor(creds) && ghostReady) {
      cancelGhostTransition();
      return true;
    }
    if (starting === inFlight) break;
  }

  if (!detectTauriRuntime()) return false;

  const startPromise = (async () => {
    if (needPreview) {
      await spawnGhostSession(creds);
    } else {
      if (await hasTransferLease(creds)) return;
      await spawnMainSession(creds);
    }
  })();
  starting = startPromise;

  try {
    await startPromise;
    if (needPreview) {
      return mode === 'ghost' && isDriveSessionReadyFor(creds) && ghostReady;
    } else {
      return mode === 'main' && isDriveSessionReadyFor(creds);
    }
  } catch (e) {
    console.warn('[drive-serve] ensureDriveSession failed', e);
    return false;
  } finally {
    if (starting === startPromise) {
      starting = null;
    }
  }
}

export function scheduleDriveSessionStop(delayMs = 750): void {
  cancelScheduledDriveSessionStop();
  scheduledStop = setTimeout(() => {
    scheduledStop = null;
    void stopDriveSession();
  }, Math.max(0, delayMs));
}

export function cancelScheduledDriveSessionStop(): void {
  if (scheduledStop == null) return;
  clearTimeout(scheduledStop);
  scheduledStop = null;
}

export async function stopDriveSession(): Promise<void> {
  cancelScheduledDriveSessionStop();
  cancelGhostTransition();
  sessionGeneration += 1;
  let quitRequested = false;
  try {
    if (ready) {
      try {
        await writeStdin(JSON.stringify({ id: 'quit', cmd: 'quit' }));
        quitRequested = true;
      } catch {
        /* ignore */
      }
    }
  } finally {
    ready = false;
    mode = 'main';
    ghostReady = false;
    activePreviews = 0;
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      const err = new Error('Drive session stopped');
      (err as any).code = 'DRIVE_SESSION_STOPPED';
      p.reject(err);
    }
    pending.clear();
    if (quitRequested) {
      await new Promise<void>((resolve) => setTimeout(resolve, 320));
    }
    try {
      await killWorkerJob(child?.jobId ?? activeJobId);
    } catch {
      /* ignore */
    }
    try {
      await killWorkerJob(API_SERVER_JOB_ID);
    } catch {
      /* ignore */
    }
    try {
      child?.dispose?.();
    } catch {
      /* ignore */
    }
    try {
      apiChild?.dispose?.();
    } catch {
      /* ignore */
    }
    child = null;
    apiChild = null;
    activeCredsKey = '';
    unsub = null;
    unsubExit = null;
  }
}

export async function driveSessionCallFor(
  creds: DriveCredentials,
  cmd: string,
  params: Record<string, any> = {},
  timeoutMs = 120000
): Promise<any> {
  const expected = credKey(creds);
  const needPreview = mode === 'ghost';
  const maxAttempts = 3;
  let lastErr: any = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Ensure session is warm and owned
    if (!isDriveSessionReadyFor(creds)) {
      const ok = await ensureDriveSession(creds, needPreview);
      if (!ok || !isDriveSessionReadyFor(creds)) {
        lastErr = new Error('Drive session is not ready for the selected account');
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 300 + attempt * 200));
          continue;
        }
        throw lastErr;
      }
    }
    if (!ready || activeCredsKey !== expected) {
      lastErr = new Error('Drive session changed before request could start');
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 300 + attempt * 200));
        continue;
      }
      throw lastErr;
    }

    try {
      return await driveSessionCall(cmd, { ...params, __session_owner: expected }, timeoutMs, expected);
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || '').toLowerCase();
      const code = e?.code || '';
      const isSessionErr =
        code === 'DRIVE_SESSION_STOPPED' ||
        code === 'DRIVE_SESSION_ENDED' ||
        /drive session stopped|drive session ended|drive session not ready|session not ready|drive session changed/i.test(msg);

      if (isSessionErr && attempt < maxAttempts - 1) {
        try {
          // Try to re-bootstrap the drive session before retrying
          await ensureDriveSession(creds, needPreview);
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 400 + attempt * 250));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export async function driveSessionCall(
  cmd: string,
  params: Record<string, any> = {},
  timeoutMs = 120000,
  expectedCredsKey = ''
): Promise<any> {
  if (!ready) {
    throw new Error('Drive session not ready');
  }
  if (expectedCredsKey && activeCredsKey !== expectedCredsKey) {
    throw new Error('Drive session ownership changed');
  }
  const id = String(++reqSeq);
  const { __session_owner: _sessionOwner, ...safeParams } = params;
  const line = JSON.stringify({ id, cmd, ...safeParams });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Drive RPC timeout: ${cmd}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    if (expectedCredsKey && activeCredsKey !== expectedCredsKey) {
      pending.delete(id);
      clearTimeout(timer);
      reject(new Error('Drive session ownership changed before write'));
      return;
    }
    writeStdin(line).catch((e) => {
      pending.delete(id);
      clearTimeout(timer);
      ready = false;
      reject(e);
    });
  });
}
