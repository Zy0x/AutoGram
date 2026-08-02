/**
 * Runtime detection: desktop (Tauri + local Python worker) vs web (static host).
 * Heavy features (re-encode, Media Studio, Telethon spawn) are desktop-only.
 */
import { isTauri } from '@tauri-apps/api/core';

export type Runtime = 'desktop' | 'web';

export type PlatformDeps = {
  /** Build-time override from VITE_RUNTIME */
  viteRuntime?: string | undefined;
  isTauri: () => boolean;
};

/** Pure resolver — unit-testable without Tauri or Vite env. */
export function resolveRuntime(deps: PlatformDeps): Runtime {
  const forced = (deps.viteRuntime || '').trim().toLowerCase();
  if (forced === 'web') return 'web';
  if (forced === 'desktop') return 'desktop';
  return deps.isTauri() ? 'desktop' : 'web';
}

/** Tauri v2 builds in the wild may expose either marker during early boot. */
export function detectTauriRuntime(): boolean {
  try {
    if (isTauri()) return true;
  } catch {
    /* fall through to the IPC marker */
  }
  if (typeof localStorage !== 'undefined' && (localStorage.getItem('AUTOGRAM_FORCE_RUNTIME') === 'desktop' || localStorage.getItem('forceDesktop') === 'true')) {
    return true;
  }
  const root = globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  };
  return typeof root.__TAURI_INTERNALS__?.invoke === 'function';
}

export function getRuntime(): Runtime {
  return resolveRuntime({
    viteRuntime: import.meta.env.VITE_RUNTIME as string | undefined,
    isTauri: detectTauriRuntime,
  });
}

export function isDesktop(): boolean {
  return getRuntime() === 'desktop';
}

export function isWeb(): boolean {
  return getRuntime() === 'web';
}

/** Local Telethon/Python worker, re-encode, path pickers, Media Studio. */
export function canUseLocalTelegramWorker(): boolean {
  return isDesktop();
}
