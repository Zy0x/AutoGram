/**
 * Unified Python worker bridge — Rust invoke only (P0).
 * No tauri-plugin-shell (args unrestricted was a privilege-escalation path).
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

export type WorkerResult = { code: number; stdout: string; stderr: string };

/** True when the worker cannot run (browser / non-Tauri). */
export function isDesktopWorkerUnavailable(result: WorkerResult): boolean {
  const err = (result.stderr || '').toLowerCase();
  return (
    result.code !== 0 &&
    (err.includes('requires desktop app') || err.includes('requires tauri'))
  );
}

/** True when invoke returned a failure with no usable JSON/stdout payload. */
export function isWorkerFailure(result: WorkerResult): boolean {
  if (result.code === 0) return false;
  const out = result.stdout || '';
  // Some actions print useful data even with non-zero code — treat as ok if JSON present
  if (out.includes('[JSON_OUTPUT]') || /^\s*\{/.test(out.trim())) return false;
  return true;
}

/** Human message for UI (alert / banner). */
export function workerErrorMessage(result: WorkerResult, fallback = 'Worker failed'): string {
  if (isDesktopWorkerUnavailable(result)) {
    return 'Fitur ini hanya tersedia di aplikasi desktop AutoGram (bukan browser).';
  }
  const err = (result.stderr || '').trim();
  const out = (result.stdout || '').trim();
  return err || out || fallback;
}

async function invokeScript(
  cmd: 'run_worker_once' | 'run_auth_manager_once',
  args: string[]
): Promise<WorkerResult> {
  const res = await invoke<{ code: number; stdout: string; stderr: string }>(cmd, {
    args,
  });
  return {
    code: res?.code ?? 1,
    stdout: res?.stdout ?? '',
    stderr: res?.stderr ?? '',
  };
}

/** daemon.py one-shot via Rust native SQLite commands (Zero-Python Engine) */
export async function runDaemonOnce(args: string[]): Promise<WorkerResult> {
  if (!isTauri()) {
    return {
      code: 1,
      stdout: '',
      stderr: 'runDaemonOnce requires desktop app (Tauri)',
    };
  }
  try {
    const actionIdx = args.indexOf('--action');
    const action = actionIdx >= 0 ? args[actionIdx + 1] : '';

    const getArg = (flag: string): string => {
      const idx = args.indexOf(flag);
      return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : '';
    };

    if (action === 'list-jobs') {
      const jobs = await invoke<any[]>('jobs_list');
      const out = JSON.stringify({ status: 'success', jobs: jobs || [] });
      return { code: 0, stdout: `[JSON_OUTPUT]\n${out}`, stderr: '' };
    }

    if (action === 'delete-job') {
      const jobId = Number(getArg('--job-id'));
      await invoke('jobs_delete', { jobId });
      return { code: 0, stdout: JSON.stringify({ status: 'success' }), stderr: '' };
    }

    if (action === 'fresh-start') {
      const jobId = Number(getArg('--job-id'));
      await invoke('jobs_fresh_start', { jobId });
      return { code: 0, stdout: JSON.stringify({ status: 'success' }), stderr: '' };
    }

    if (action === 'export-jobs') {
      const jsonStr = await invoke<string>('jobs_export_json');
      return { code: 0, stdout: `[JSON_OUTPUT]\n${jsonStr}`, stderr: '' };
    }

    if (action === 'import-jobs') {
      const filePath = getArg('--file');
      let content = getArg('--data');
      if (!content && filePath) {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        content = await readTextFile(filePath);
      }
      const count = await invoke<number>('jobs_import_json', { json: content || '[]' });
      return { code: 0, stdout: JSON.stringify({ status: 'success', count }), stderr: '' };
    }

    if (action === 'list-profiles') {
      const profiles = await invoke<any[]>('profiles_list');
      const out = JSON.stringify({ status: 'success', profiles: profiles || [] });
      return { code: 0, stdout: `[JSON_OUTPUT]\n${out}`, stderr: '' };
    }

    if (action === 'save-profile') {
      const idStr = getArg('--id');
      const name = getArg('--name');
      const sessionPath = getArg('--session');
      const id = idStr ? Number(idStr) : undefined;
      const resId = await invoke<number>('profiles_save', {
        request: { id, name, sessionFilePath: sessionPath || name },
      });
      return { code: 0, stdout: JSON.stringify({ status: 'success', id: resId }), stderr: '' };
    }

    if (action === 'delete-profile') {
      const id = Number(getArg('--id'));
      await invoke('profiles_delete', { id });
      return { code: 0, stdout: JSON.stringify({ status: 'success' }), stderr: '' };
    }

    if (action === 'list-automations') {
      const automations = await invoke<any[]>('automations_list');
      const out = JSON.stringify({ status: 'success', automations: automations || [] });
      return { code: 0, stdout: `[JSON_OUTPUT]\n${out}`, stderr: '' };
    }

    if (action === 'save-automation') {
      const idStr = getArg('--id');
      const name = getArg('--name');
      const cron = getArg('--cron');
      const actionType = getArg('--type');
      const config = getArg('--config');
      const id = idStr ? Number(idStr) : undefined;
      const resId = await invoke<number>('automations_save', {
        request: {
          id,
          name,
          scheduleCron: cron || null,
          actionType: actionType || 'sync',
          configJson: config || '{}',
        },
      });
      return { code: 0, stdout: JSON.stringify({ status: 'success', id: resId }), stderr: '' };
    }

    if (action === 'delete-automation') {
      const id = Number(getArg('--id'));
      await invoke('automations_delete', { id });
      return { code: 0, stdout: JSON.stringify({ status: 'success' }), stderr: '' };
    }

    if (action === 'stats') {
      const stats = await invoke<any>('stats_get');
      const out = JSON.stringify({ status: 'success', stats });
      return { code: 0, stdout: `[JSON_OUTPUT]\n${out}`, stderr: '' };
    }

    if (action === 'export-csv') {
      const csvData = await invoke<string>('stats_export_csv');
      return { code: 0, stdout: csvData, stderr: '' };
    }

    if (action === 'clear-transfer-database') {
      const res = await invoke<any>('cache_clear_disk');
      return { code: 0, stdout: JSON.stringify(res || { status: 'success' }), stderr: '' };
    }

    // Fallback to run_worker_once if unknown action
    return await invokeScript('run_worker_once', args);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.warn('Native Rust runDaemonOnce failed', e);
    return { code: 1, stdout: '', stderr: msg };
  }
}

/** auth_manager.py one-shot routed via Rust Grammers native commands (Zero-Python Auth Engine) */
export async function runAuthManagerOnce(args: string[]): Promise<WorkerResult> {
  if (!isTauri()) {
    return {
      code: 1,
      stdout: '',
      stderr: 'runAuthManagerOnce requires desktop app (Tauri)',
    };
  }
  try {
    const getArg = (flag: string): string => {
      const idx = args.indexOf(flag);
      return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : '';
    };

    const session = getArg('--session');
    const apiId = Number(getArg('--api-id')) || 0;
    const apiHash = getArg('--api-hash');
    const phone = getArg('--phone');
    const code = getArg('--code');
    const password = getArg('--password');

    // 1) Auth Status check
    if (args.includes('status')) {
      const res = await invoke<any>('tg_auth_status', {
        identity: { session, apiId, apiHash },
      });
      if (res?.ok && res?.data?.authorized) {
        return { code: 0, stdout: JSON.stringify({ status: 'already_authorized', user: res.data.user }), stderr: '' };
      }
      return { code: 0, stdout: JSON.stringify({ status: 'unauthorized' }), stderr: '' };
    }

    // 2) Native login / send_code / sign_in / 2fa
    const loginRes = await invoke<any>('tg_login', {
      request: {
        session,
        apiId,
        apiHash,
        phone: phone || '',
        code: code || null,
        password: password || null,
      },
    });

    if (loginRes?.ok && loginRes?.data) {
      const d = loginRes.data;
      if (d.status === 'already_authorized') {
        return { code: 0, stdout: JSON.stringify({ status: 'already_authorized', user: d.user }), stderr: '' };
      }
      if (d.needsCode) {
        return { code: 0, stdout: JSON.stringify({ status: 'code_sent' }), stderr: '' };
      }
      if (d.needsPassword) {
        return { code: 0, stdout: JSON.stringify({ status: '2fa_required', hint: d.passwordHint }), stderr: '' };
      }
      return { code: 0, stdout: JSON.stringify({ status: 'success', user: d.user }), stderr: '' };
    }

    const err = loginRes?.error?.message || loginRes?.userMessage || 'Auth operation failed';
    return { code: 1, stdout: '', stderr: err };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.warn('Native Rust runAuthManagerOnce failed', e);
    return { code: 1, stdout: '', stderr: msg };
  }
}
