/**
 * App-wide Debug Mode — Settings toggle.
 * Syncs localStorage + worker/temp/autogram_debug.txt for Python workers.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';

const LS_KEY = 'autogram_debug_mode';
const FLAG_NAME = 'autogram_debug.txt';
/** Larger buffer so multi-layer (FE/Rust/Python) traces stay inspectable. */
const MAX_BUFFER = 800;

type Listener = (on: boolean) => void;

let buffer: string[] = [];
const listeners = new Set<Listener>();

export function isDebugMode(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function getDebugLogBuffer(): string[] {
  return buffer.slice();
}

export function clearDebugLogBuffer(): void {
  buffer = [];
}

export function subscribeDebugMode(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(on: boolean) {
  listeners.forEach((cb) => {
    try {
      cb(on);
    } catch {
      /* ignore */
    }
  });
}

/** Redact sensitive CLI args for logs */
export function redactArgsForLog(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const prev = i > 0 ? args[i - 1] : '';
    if (
      prev === '--api-hash' ||
      prev === '--api_hash' ||
      a.startsWith('--api-hash=') ||
      a.startsWith('--api_hash=')
    ) {
      if (a.includes('=')) out.push(a.split('=')[0] + '=***');
      else out.push('***');
      continue;
    }
    if (prev === '--session' || a.startsWith('--session=')) {
      if (a.includes('=')) out.push('--session=***');
      else out.push('***');
      continue;
    }
    out.push(a);
  }
  return out;
}

export function debugLog(scope: string, message: string, data?: unknown): void {
  if (!isDebugMode()) return;
  const ts = new Date().toISOString().slice(11, 23);
  let extra = '';
  if (data !== undefined) {
    try {
      extra = ' ' + JSON.stringify(data);
    } catch {
      extra = ' ' + String(data);
    }
  }
  const line = `${ts} [${scope}] ${message}${extra}`;
  buffer.push(line);
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
  try {
    console.info(`[AutoGram:debug] ${line}`);
  } catch {
    /* ignore */
  }
}

/** Ingest raw worker / Rust stdout/stderr when debug is on. */
export function ingestWorkerDebugLine(line: string): void {
  if (!isDebugMode()) return;
  const text = String(line || '');
  if (!text.trim()) return;
  const isEvent = text.includes('[EVENT]');
  const interestingEvent =
    isEvent &&
    /StudioProgress|StudioItem|StudioFinished|StudioFailed|DriveProgress|DriveItem|FloodWait|DebugLog|TransferLog|FALLBACK|fallback|stream_|Session|orch_|auth_|error|Error|ready/.test(
      text
    );
  const isStructured =
    text.includes('[DEBUG]') ||
    text.includes('[TRANSFER]') ||
    text.includes('[autogram:tg]') ||
    text.includes('[autogram:') ||
    text.includes('studio-serve') ||
    text.includes('FloodWait') ||
    text.includes('FLOOD_WAIT') ||
    /level":\s*"(ERROR|WARN|INFO|DEBUG)"/i.test(text);
  if (isStructured || interestingEvent || /Traceback|Exception|Error:/.test(text)) {
    let short = text.length > 700 ? text.slice(0, 700) + '…' : text;
    // Compact StudioProgress noise: keep milestone-ish lines
    if (isEvent && text.includes('StudioProgress')) {
      try {
        const m = text.indexOf('{');
        if (m >= 0) {
          const o = JSON.parse(text.slice(m));
          const p = o.payload || o;
          const pct = Number(p.percent || 0);
          if (pct > 0.5 && pct < 99.5 && Math.floor(pct) % 5 !== 0) {
            return; // drop non-5% ticks from debug buffer
          }
          short = `PROGRESS ${pct.toFixed(1)}% · ${p.speed_mb_s || 0} MB/s · item ${p.item_index ?? '?'}`;
        }
      } catch {
        /* keep raw */
      }
    }
    // Prefix layer for multi-backend tracing
    const layer = text.includes('[autogram:tg]')
      ? 'rust'
      : text.includes('[DEBUG]') || isEvent
        ? 'python'
        : 'worker';
    const stamped = `[${layer}] ${short}`;
    buffer.push(stamped);
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
    try {
      console.info('[AutoGram:worker]', stamped.slice(0, 360));
    } catch {
      /* ignore */
    }
  }
}

/** Explicit multi-layer log (frontend orchestration). */
export function debugLogLayer(
  layer: 'frontend' | 'rust' | 'python' | 'hybrid',
  scope: string,
  message: string,
  data?: unknown
): void {
  if (!isDebugMode()) return;
  debugLog(`${layer}:${scope}`, message, data);
}

/** Clipboard with textarea fallback (WebView often blocks clipboard API). */
export async function copyTextWithFallback(text: string): Promise<boolean> {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch {
    return false;
  }
}

async function writeFlag(on: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    if (on) {
      await invoke<string>('write_worker_temp_file', {
        filename: FLAG_NAME,
        contents: '1',
      });
    } else {
      try {
        const path = await invoke<string>('write_worker_temp_file', {
          filename: FLAG_NAME,
          contents: '0',
        });
        await invoke('delete_worker_temp_file', { path });
      } catch {
        /* flag may already be gone */
      }
    }
  } catch (e) {
    console.warn('sync debug flag failed', e);
  }
}

export async function setDebugMode(on: boolean): Promise<void> {
  try {
    localStorage.setItem(LS_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  await writeFlag(on);
  if (isTauri()) {
    try {
      if (on) {
        await invoke('app_open_devtools');
      } else {
        await invoke('app_close_devtools');
      }
    } catch {
      /* ignore */
    }
  }
  debugLog('debugMode', on ? 'Debug Mode ON' : 'Debug Mode OFF');
  notify(on);
}

let shortcutRegistered = false;

export function setupDevToolsShortcut(): void {
  if (shortcutRegistered || typeof window === 'undefined') return;
  shortcutRegistered = true;

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const isF12 = e.key === 'F12';
    const isInspect = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i');

    if (isF12 || isInspect) {
      if (isDebugMode() && isTauri()) {
        e.preventDefault();
        invoke('app_toggle_devtools').catch(() => {});
      }
    }
  });
}

/** Call on app boot if localStorage says ON. */
export async function bootstrapDebugMode(): Promise<boolean> {
  setupDevToolsShortcut();
  const on = isDebugMode();
  if (on) {
    await writeFlag(true);
    debugLog('debugMode', 'bootstrapped ON from localStorage');
    if (isTauri()) {
      try {
        await invoke('app_open_devtools');
      } catch {
        /* ignore */
      }
    }
  } else {
    await writeFlag(false);
    if (isTauri()) {
      try {
        await invoke('app_close_devtools');
      } catch {
        /* ignore */
      }
    }
  }
  return on;
}

export function debugLogFileHint(): string {
  return 'worker/temp/autogram_debug.log';
}

