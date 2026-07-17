/**
 * Persistent Drive worker session — one Telethon connection for the Media Studio tab.
 * Avoids multi-second reconnect cost on every list/thumb call.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { spawnDaemonJob, killWorkerJob, type JobChild } from './jobProcess';
import type { DriveCredentials } from './driveApi';
import { detectTauriRuntime } from './platform';

export const DRIVE_SERVE_JOB_ID = 991003;

type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let child: JobChild | null = null;
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

function credKey(c: DriveCredentials) {
  return `${c.session}|${c.apiId}`;
}

/**
 * A ready worker is only useful when it belongs to the requested Telegram
 * session.  Treating a worker from another session as ready can leak dialog
 * folders, peers, and Saved Messages between accounts during a rapid switch.
 */
export function isDriveSessionReadyFor(creds: DriveCredentials | null | undefined) {
  return !!creds && ready && activeCredsKey === credKey(creds);
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
  await invoke('write_worker_stdin', { jobId: DRIVE_SERVE_JOB_ID, line });
}

export function isDriveSessionReady() {
  // `ready` is emitted by the live worker after Rust has registered the job.
  // The optional JS handle can be cleared by a stale same-job exit listener,
  // while stdin RPC by job id remains fully usable.
  return ready;
}

/**
 * Start warm drive-serve if possible.
 * Returns true when session is ready; false means use one-shot fallback (never throw for UI blank).
 */
export async function ensureDriveSession(creds: DriveCredentials): Promise<boolean> {
  cancelScheduledDriveSessionStop();
  const key = credKey(creds);
  if (isDriveSessionReadyFor(creds)) return true;

  // A switch can arrive while another session is still starting. Wait for
  // that generation to settle, then re-check ownership; never reuse its
  // generic `ready` flag for these credentials.
  while (starting) {
    const inFlight = starting;
    try {
      await inFlight;
    } catch {
      // The requested session may still be startable after the old one failed.
    }
    if (isDriveSessionReadyFor(creds)) return true;
    if (starting === inFlight) break;
  }

  if (!detectTauriRuntime()) return false;

  const startPromise = (async () => {
    await stopDriveSession();
    // Rust worker-exit events are asynchronous. Let the previous job-id event
    // drain before attaching listeners for its replacement.
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    const generation = ++sessionGeneration;
    activeCredsKey = key;
    ready = false;
    const settleCurrentLine = (line: string) => {
      if (generation === sessionGeneration) settleLine(line);
    };

    const unsubs: UnlistenFn[] = [];
    let processAssigned = false;
    unsub = await listen<{ jobId: number; line: string; stream: string }>('worker-line', (ev) => {
      const p = ev.payload as any;
      const jid = p?.jobId ?? p?.job_id;
      if (Number(jid) !== DRIVE_SERVE_JOB_ID) return;
      if (generation !== sessionGeneration) return;
      if (p.stream === 'stderr') {
        console.warn('[drive-serve]', p.line);
        return;
      }
      settleCurrentLine(p.line);
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
          pend.reject(new Error('Drive session ended'));
        }
        pending.clear();
      };
      if (!ready) {
        // This can be the previous same-job process exiting during startup.
        // The replacement's forthcoming `ready` event is authoritative.
        return;
      }
      if (Date.now() - readyAt < 5_000) {
        // start_worker_job can deliver the previous same-id exit after the
        // replacement already said ready. The new worker is authoritative.
        return;
      }
      // Same job id has no generation in Rust events. Probe stdin before
      // treating an exit as current; a stale exit must not disable live RPCs.
      void driveSessionCall('ping', {}, 1500).catch(markEnded);
    });
    unsubs.push(unsubExit);

    await new Promise<void>((resolve, reject) => {
      // Ready fires as soon as the worker process is up (before Telethon connect).
      // Connect continues in background; RPCs wait server-side. Keep timeout for
      // true spawn failures only — 8s is enough for process start.
      const t = setTimeout(() => {
        clearInterval(onReadyCheck);
        reject(new Error('Drive session start timeout'));
      }, 20000);
      const onReadyCheck = setInterval(() => {
        if (ready && processAssigned) {
          clearInterval(onReadyCheck);
          clearTimeout(t);
          resolve();
        }
      }, 40);

      spawnDaemonJob({
        jobId: DRIVE_SERVE_JOB_ID,
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
        // The dedicated worker-exit listener above performs a liveness probe.
        // A raw same-job close event cannot identify old vs replacement jobs.
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
          clearInterval(onReadyCheck);
          clearTimeout(t);
          reject(e);
        });
    });
  })();
  starting = startPromise;

  try {
    await startPromise;
    return isDriveSessionReadyFor(creds);
  } catch (e) {
    console.warn('[drive-serve] warm session unavailable, using one-shot fallback', e);
    if (activeCredsKey === key) {
      ready = false;
      child = null;
    }
    return false;
  } finally {
    if (starting === startPromise) {
      starting = null;
    }
  }
}

/**
 * React StrictMode replays mount cleanup in development. Delaying teardown lets
 * the immediate remount cancel it instead of killing a session that is booting.
 * A real navigation still tears the worker down shortly afterwards.
 */
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
  sessionGeneration += 1;
  try {
    if (ready) {
      try {
        await writeStdin(JSON.stringify({ id: 'quit', cmd: 'quit' }));
      } catch {
        /* ignore */
      }
    }
  } finally {
    ready = false;
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Drive session stopped'));
    }
    pending.clear();
    try {
      await killWorkerJob(DRIVE_SERVE_JOB_ID);
    } catch {
      /* ignore */
    }
    try {
      child?.dispose?.();
    } catch {
      /* ignore */
    }
    child = null;
    activeCredsKey = '';
    unsub = null;
    unsubExit = null;
  }
}

/**
 * Session-owned RPC. Ownership is checked both before and immediately before
 * stdin write, closing the A->B switch race where an old caller could write to
 * the newly-started worker.
 */
export async function driveSessionCallFor(
  creds: DriveCredentials,
  cmd: string,
  params: Record<string, any> = {},
  timeoutMs = 120000
): Promise<any> {
  const expected = credKey(creds);
  if (!isDriveSessionReadyFor(creds)) {
    const ok = await ensureDriveSession(creds);
    if (!ok || !isDriveSessionReadyFor(creds)) {
      throw new Error('Drive session is not ready for the selected account');
    }
  }
  if (!ready || activeCredsKey !== expected) {
    throw new Error('Drive session changed before request could start');
  }
  return driveSessionCall(cmd, { ...params, __session_owner: expected }, timeoutMs, expected);
}

/** Call a cmd on the warm session. */
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
