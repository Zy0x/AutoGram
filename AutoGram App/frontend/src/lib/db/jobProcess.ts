/**
 * Job process helpers — Rust-isolated spawn (start_worker_job) only (P0).
 * Shell fallback is opt-in and usually blocked by capabilities.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { debugLog, ingestWorkerDebugLine, isDebugMode, redactArgsForLog } from '../utils/debugMode';

export type JobChild = {
  jobId: number;
  /** cleanup listeners */
  dispose?: () => void;
};

export type SpawnJobOptions = {
  jobId: number;
  args: string[];
  onStdoutLine: (line: string) => void;
  onStderrLine: (line: string) => void;
  onClose: (code: number | null) => void;
  /**
   * Shell fallback is disabled by default (P0): capabilities no longer allow
   * unrestricted python args, and shell spawn can force-close the host on Windows.
   * Prefer Rust start_worker_job only.
   */
  allowShellFallback?: boolean;
  /** Pipe stdin for interactive workers (drive-serve). */
  pipeStdin?: boolean;
};

/** Parse first complete JSON object after [EVENT] marker */
export function parseEventLine(line: string): { type?: string; payload?: any; [k: string]: any } | null {
  try {
    const text = String(line ?? '');
    const marker = text.indexOf('[EVENT]');
    if (marker < 0) return null;
    const rest = text.slice(marker + 7).trim();
    const start = rest.indexOf('{');
    if (start < 0) return null;
    
    // FAST PATH: try native parsing directly from first { to last }
    const end = rest.lastIndexOf('}');
    if (end >= start) {
      try {
        return JSON.parse(rest.slice(start, end + 1));
      } catch {
        // fallback to slow parser if junk with '}' exists at the end
      }
    }

    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < rest.length; i++) {
      const ch = rest[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return JSON.parse(rest.slice(start, i + 1));
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** One-shot daemon call — Rust invoke only (no shell). */
export async function runDaemonOnce(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!isTauri()) {
    return {
      code: 1,
      stdout: '',
      stderr: 'runDaemonOnce requires desktop app (Tauri)',
    };
  }
  try {
    const res = await invoke<{ code: number; stdout: string; stderr: string }>('run_worker_once', {
      args,
    });
    return {
      code: res?.code ?? 0,
      stdout: res?.stdout ?? '',
      stderr: res?.stderr ?? '',
    };
  } catch (e: any) {
    console.warn('run_worker_once invoke failed', e);
    return {
      code: 1,
      stdout: '',
      stderr: String(e?.message || e || 'run_worker_once failed — rebuild desktop app'),
    };
  }
}

export async function requestJobPause(jobId: number): Promise<void> {
  if (isTauri()) {
    await invoke('jobs_cancel_migration', { jobId });
    return;
  }
  await runDaemonOnce(['--action', 'set-status', '--job-id', String(jobId), '--status', 'paused']);
}

/** Hard-kill worker process (Media Studio Cancel / emergency stop). */
export async function killWorkerJob(jobId: number): Promise<boolean> {
  if (isTauri()) {
    try {
      const ok = await invoke<boolean>('kill_worker_job', { jobId });
      return !!ok;
    } catch (e) {
      console.warn('kill_worker_job failed', e);
    }
  }
  return false;
}

/**
 * Spawn long-running job.
 * Prefer Rust start_worker_job (isolated process + event stream).
 * Shell fallback is DANGEROUS on Windows (can force-close the whole app).
 */
export async function spawnDaemonJob(opts: SpawnJobOptions): Promise<JobChild> {
  let closed = false;
  // P0: shell fallback off unless explicitly requested (and capabilities allow it)
  const allowShell = opts.allowShellFallback === true;
  const safeClose = (code: number | null) => {
    if (closed) return;
    closed = true;
    try {
      opts.onClose(code);
    } catch (e) {
      console.warn('onClose', e);
    }
  };

  // Normalize args: prefer ["--files-json", path] over ["--files-json=path with spaces"]
  const args = normalizeDaemonArgs(opts.args);

  if (isDebugMode()) {
    debugLog('jobProcess', `spawn job ${opts.jobId}`, {
      args: redactArgsForLog(args).slice(0, 40),
      pipeStdin: !!opts.pipeStdin,
    });
  }

  // --- Preferred path: Rust isolated spawn ---
  if (isTauri()) {
    const unsubs: UnlistenFn[] = [];
    try {
      const u1 = await listen<{ jobId: number; line: string; stream: string }>(
        'worker-line',
        (ev) => {
          try {
            const p = ev.payload;
            // accept camelCase (serde) or snake_case
            const jid = p?.jobId ?? (p as any)?.job_id;
            if (jid === undefined || Number(jid) !== Number(opts.jobId)) return;
            if (isDebugMode()) ingestWorkerDebugLine(p.line);
            if (p.stream === 'stderr') opts.onStderrLine(p.line);
            else opts.onStdoutLine(p.line);
          } catch (e) {
            console.warn('worker-line handler', e);
          }
        }
      );
      unsubs.push(u1);

      const u2 = await listen<{ jobId: number; code: number }>('worker-exit', (ev) => {
        try {
          const p = ev.payload as any;
          const jid = p?.jobId ?? p?.job_id;
          if (jid === undefined || Number(jid) !== Number(opts.jobId)) return;
          if (isDebugMode()) {
            debugLog('jobProcess', `job ${opts.jobId} exit`, { code: p.code });
          }
          // Always treat worker exit as non-fatal for UI
          safeClose(typeof p.code === 'number' ? p.code : 0);
          unsubs.forEach((u) => {
            try {
              u();
            } catch {
              /* ignore */
            }
          });
        } catch (e) {
          console.warn('worker-exit handler', e);
          safeClose(0);
        }
      });
      unsubs.push(u2);

      await invoke('start_worker_job', {
        jobId: opts.jobId,
        args,
        pipeStdin: opts.pipeStdin === true,
      });

      return {
        jobId: opts.jobId,
        dispose: () => {
          unsubs.forEach((u) => {
            try {
              u();
            } catch {
              /* ignore */
            }
          });
        },
      };
    } catch (e) {
      console.warn('Rust start_worker_job failed', e);
      unsubs.forEach((u) => {
        try {
          u();
        } catch {
          /* ignore */
        }
      });
      if (!allowShell) {
        throw new Error(
          `start_worker_job failed (rebuild app required to avoid force-close): ${String(
            (e as any)?.message || e
          )}`
        );
      }
      // fall through to shell only if explicitly allowed
    }
  }

  // P0: no shell spawn — unrestricted python args were removed from capabilities
  throw new Error(
    allowShell
      ? 'Shell spawn is disabled (P0 hardening). Rebuild desktop app so start_worker_job is available.'
      : 'Worker spawn requires Tauri Rust bridge (start_worker_job). Rebuild with: npm run tauri dev'
  );
}

/** Split --key=value into [--key, value] so paths with spaces stay intact. */
function normalizeDaemonArgs(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      const key = a.slice(0, eq);
      const val = a.slice(eq + 1);
      // Keep flags without values as-is
      if (val.length > 0 && (val.includes(' ') || val.includes('[') || /^[A-Za-z]:\\/.test(val))) {
        out.push(key, val);
        continue;
      }
    }
    out.push(a);
  }
  return out;
}
