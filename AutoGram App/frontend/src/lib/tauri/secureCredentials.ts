/**
 * Secure API credentials — Tauri encrypted store (P0).
 * Migrates legacy localStorage API_ID / API_HASH once, then removes them.
 */
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { detectTauriRuntime } from './platform';
import type { DriveTransferSettings } from '../telegram/driveTypes';

export function notifyApiCredentialsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('autogram-api-credentials-changed'));
  }
}

export function notifyApiError() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('autogram-api-error'));
  }
}

export async function checkApiCredentialsConnected(): Promise<boolean> {
  try {
    const creds = await getApiCredentials();
    if (!creds || !creds.apiId || !creds.apiId.trim() || !creds.apiHash || !creds.apiHash.trim()) {
      return false;
    }
    const verifyRes = await verifyTelegramApiCredentials(creds.apiId, creds.apiHash);
    return verifyRes.ok;
  } catch {
    return false;
  }
}

export function useApiCredentialsStatus() {
  const [hasError, setHasError] = useState<boolean>(false);

  const checkStatus = useCallback(async () => {
    const isConnected = await checkApiCredentialsConnected();
    setHasError(!isConnected);
  }, []);

  useEffect(() => {
    void checkStatus();

    const handleChanged = () => { void checkStatus(); };
    const handleError = () => { setHasError(true); };
    const handleFocus = () => { void checkStatus(); };

    // Gentle background watchdog: re-verify credentials status every 60 seconds (safe & rate-limit friendly)
    const intervalId = setInterval(() => {
      void checkStatus();
    }, 60000);

    window.addEventListener('autogram-api-credentials-changed', handleChanged);
    window.addEventListener('autogram-api-error', handleError);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('storage', handleChanged);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('autogram-api-credentials-changed', handleChanged);
      window.removeEventListener('autogram-api-error', handleError);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('storage', handleChanged);
    };
  }, [checkStatus]);

  return { hasError, recheck: checkStatus };
}

const LS_ID = 'API_ID';
const LS_HASH = 'API_HASH';

export type ApiCredentials = { apiId: string; apiHash: string };

let memoryCache: ApiCredentials | null = null;
let migrateAttempted = false;
let bootstrapPromise: Promise<ApiCredentials> | null = null;

async function invokeGet(key: string): Promise<string | null> {
  if (!detectTauriRuntime()) return null;
  try {
    const v = await invoke<string | null>('get_credential', { key });
    return v ?? null;
  } catch {
    return null;
  }
}

async function invokeSet(key: string, value: string): Promise<boolean> {
  if (!detectTauriRuntime()) return false;
  try {
    await invoke('set_credential', { key, value });
    return true;
  } catch (e) {
    console.warn('set_credential failed', e);
    return false;
  }
}

/** One-time migrate from localStorage → secure store, then wipe LS. */
export async function migrateLegacyLocalStorageCredentials(): Promise<void> {
  if (migrateAttempted) return;
  migrateAttempted = true;
  try {
    const lsId = localStorage.getItem(LS_ID) || '';
    const lsHash = localStorage.getItem(LS_HASH) || '';
    if (!lsId && !lsHash) return;

    if (detectTauriRuntime()) {
      try {
        await invoke('migrate_credentials_from_webstorage', {
          apiId: lsId,
          apiHash: lsHash,
        });
        localStorage.removeItem(LS_ID);
        localStorage.removeItem(LS_HASH);
        memoryCache = null;
        return;
      } catch (e) {
        console.warn('migrate_credentials failed', e);
      }
    }
  } catch {
    /* ignore */
  }
}

// ── Backup storage keys (obfuscated to avoid accidental tampering) ──────────────
const LS_BACKUP_KEY = '__ag_cred_v2__';

/** Simple reversible obfuscation (NOT encryption — just anti-casual-read). */
function obfuscate(raw: string): string {
  return btoa(unescape(encodeURIComponent(raw)));
}
function deobfuscate(encoded: string): string {
  try { return decodeURIComponent(escape(atob(encoded))); } catch { return ''; }
}

function readBackup(): { apiId: string; apiHash: string } | null {
  try {
    const raw = localStorage.getItem(LS_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(deobfuscate(raw));
    if (parsed?.i && parsed?.h) return { apiId: parsed.i, apiHash: parsed.h };
  } catch { /* ignore */ }
  return null;
}

function writeBackup(apiId: string, apiHash: string): void {
  try {
    localStorage.setItem(LS_BACKUP_KEY, obfuscate(JSON.stringify({ i: apiId, h: apiHash, ts: Date.now() })));
  } catch { /* ignore */ }
}

function clearBackup(): void {
  try { localStorage.removeItem(LS_BACKUP_KEY); } catch { /* ignore */ }
}

export async function getApiCredentials(): Promise<ApiCredentials> {
  await migrateLegacyLocalStorageCredentials();

  // P2: memory cache
  if (memoryCache && memoryCache.apiId && memoryCache.apiHash) {
    return memoryCache;
  }

  if (detectTauriRuntime()) {
    // P0: Tauri encrypted keystore (primary)
    const [apiIdRaw, apiHashRaw] = await Promise.all([
      invokeGet('API_ID'),
      invokeGet('API_HASH'),
    ]);

    if (apiIdRaw && apiHashRaw) {
      memoryCache = { apiId: apiIdRaw, apiHash: apiHashRaw };
      // Keep backup in sync
      writeBackup(apiIdRaw, apiHashRaw);
      return memoryCache;
    }

    // P1: Tauri store failed (e.g., after update / OS keychain issue) → recover from backup
    const backup = readBackup();
    if (backup && backup.apiId && backup.apiHash) {
      // Attempt to re-seed Tauri store from backup silently
      try {
        await invokeSet('API_ID', backup.apiId);
        await invokeSet('API_HASH', backup.apiHash);
      } catch { /* best-effort */ }
      memoryCache = backup;
      return memoryCache;
    }

    // Nothing stored yet — return empty (no dangerous default)
    memoryCache = { apiId: '', apiHash: '' };
    return memoryCache;
  }

  // Web / offline fallback: use backup or legacy LS
  const backup = readBackup();
  if (backup && backup.apiId && backup.apiHash) {
    memoryCache = backup;
    return memoryCache;
  }
  const apiId = localStorage.getItem(LS_ID) || '';
  const apiHash = localStorage.getItem(LS_HASH) || '';
  memoryCache = { apiId, apiHash };
  return memoryCache;
}

export async function setApiCredentials(apiId: string, apiHash: string): Promise<void> {
  const id = String(apiId || '').trim();
  const hash = String(apiHash || '').trim();

  if (detectTauriRuntime()) {
    // Save to Tauri store — retry once if first attempt fails
    let okId = await invokeSet('API_ID', id);
    let okHash = await invokeSet('API_HASH', hash);
    if (!okId || !okHash) {
      await new Promise(r => setTimeout(r, 300));
      okId = await invokeSet('API_ID', id);
      okHash = await invokeSet('API_HASH', hash);
    }

    // Always update backup and memory cache regardless of Tauri store result
    writeBackup(id, hash);
    localStorage.removeItem(LS_ID);
    localStorage.removeItem(LS_HASH);
    memoryCache = { apiId: id, apiHash: hash };

    // Post-save read-back verification
    try {
      const checkId = (await invokeGet('API_ID')) || '';
      const checkHash = (await invokeGet('API_HASH')) || '';
      if (checkId !== id || checkHash !== hash) {
        console.warn('[AutoGram] Tauri store verify mismatch — backup preserved');
      }
    } catch { /* ignore */ }

    notifyApiCredentialsChanged();
    return;
  }

  // Fallback (web or if Rust store unavailable)
  localStorage.setItem(LS_ID, id);
  localStorage.setItem(LS_HASH, hash);
  writeBackup(id, hash);
  memoryCache = { apiId: id, apiHash: hash };
  notifyApiCredentialsChanged();
}

let lastVerifyTime = 0;
let lastVerifyResult: { ok: boolean; errorKey?: string } | null = null;
let lastVerifyKey = '';

export async function verifyTelegramApiCredentials(
  apiId: string,
  apiHash: string
): Promise<{ ok: boolean; errorKey?: string }> {
  const id = String(apiId || '').trim();
  const hash = String(apiHash || '').trim();

  if (!id || !hash) {
    return { ok: false, errorKey: 'api_setup_error_empty' };
  }
  if (!/^\d{4,10}$/.test(id)) {
    return { ok: false, errorKey: 'api_setup_error_id_invalid' };
  }
  if (!/^[a-fA-F0-9]{32}$/.test(hash)) {
    return { ok: false, errorKey: 'api_setup_error_hash_invalid' };
  }

  // Cooldown protection: reuse result if re-submitted within 2.5s to avoid FloodWait
  const now = Date.now();
  const verifyKey = `${id}:${hash}`;
  if (now - lastVerifyTime < 2500 && lastVerifyKey === verifyKey && lastVerifyResult) {
    return lastVerifyResult;
  }
  lastVerifyTime = now;
  lastVerifyKey = verifyKey;

  // Perform 1-shot background QR code handshake test against Telegram servers
  if (detectTauriRuntime()) {
    const testSessionName = `test_verify_${Date.now()}`;
    return new Promise<{ ok: boolean; errorKey?: string }>(async (resolve) => {
      let resolved = false;
      let unlistenFn: (() => void) | null = null;

      const cleanup = async () => {
        if (unlistenFn) {
          try { unlistenFn(); } catch {}
        }
        try {
          await invoke('delete_session_rust', { session: testSessionName });
        } catch {}
      };

      const timer = setTimeout(async () => {
        if (!resolved) {
          resolved = true;
          await cleanup();
          const res = { ok: true };
          lastVerifyResult = res;
          resolve(res);
        }
      }, 5000);

      try {
        unlistenFn = await listen<any>('qr-event', async (event) => {
          const payload = event.payload || {};
          if (payload.session && payload.session !== testSessionName) return;

          if (payload.status === 'qr_code' || payload.status === 'already_authorized' || payload.status === '2fa_required') {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              await cleanup();
              const res = { ok: true };
              lastVerifyResult = res;
              resolve(res);
            }
          } else if (payload.status === 'error') {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              await cleanup();
              const errStr = String(payload.error || '');
              if (/API_ID_INVALID|400|invalid/i.test(errStr)) {
                const res = {
                  ok: false,
                  errorKey: 'api_setup_error_telegram',
                };
                lastVerifyResult = res;
                resolve(res);
              } else {
                const res = { ok: true };
                lastVerifyResult = res;
                resolve(res);
              }
            }
          }
        });

        await invoke('start_rust_qr_login', {
          session: testSessionName,
          apiId: Number(id),
          apiHash: hash,
        });
      } catch (err: any) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          await cleanup();
          const msg = String(err?.message || err || '');
          if (/API_ID_INVALID|400|RPC error/i.test(msg)) {
            const res = {
              ok: false,
              errorKey: 'api_setup_error_telegram',
            };
            lastVerifyResult = res;
            resolve(res);
          } else {
            const res = { ok: true };
            lastVerifyResult = res;
            resolve(res);
          }
        }
      }
    });
  }

  return { ok: true };
}

export async function clearApiCredentials(): Promise<void> {
  memoryCache = null;
  if (detectTauriRuntime()) {
    try {
      await invoke('delete_credential', { key: 'API_ID' });
      await invoke('delete_credential', { key: 'API_HASH' });
    } catch {
      /* ignore */
    }
  }
  localStorage.removeItem(LS_ID);
  localStorage.removeItem(LS_HASH);
  clearBackup();
  notifyApiCredentialsChanged();
}

/** Sync helpers for gradual migration — prefer async getApiCredentials */
export function getApiIdSync(): string {
  return memoryCache?.apiId || localStorage.getItem(LS_ID) || '';
}

export function getApiHashSync(): string {
  return memoryCache?.apiHash || localStorage.getItem(LS_HASH) || '';
}

/** Call once at app start (desktop). */
export async function bootstrapSecureCredentials(): Promise<ApiCredentials> {
  if (memoryCache?.apiId && memoryCache.apiHash) return memoryCache;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    // Read the existing secure store first. Directory setup and .env seeding are
    // recovery paths, not work every caller should repeat during React boot.
    let creds = await getApiCredentials();
    if (creds.apiId && creds.apiHash) return creds;

    if (detectTauriRuntime()) {
      try {
        await invoke('ensure_secure_dirs');
      } catch {
        /* ignore */
      }
      try {
        await invoke('seed_api_credentials_from_env');
        memoryCache = null;
      } catch {
        /* ignore */
      }
      creds = await getApiCredentials();
    }

    // If still empty but localStorage has values (failed migrate earlier), re-push.
    if ((!creds.apiId || !creds.apiHash) && detectTauriRuntime()) {
      const lsId = localStorage.getItem(LS_ID) || '';
      const lsHash = localStorage.getItem(LS_HASH) || '';
      if (lsId || lsHash) {
        try {
          await setApiCredentials(lsId || creds.apiId, lsHash || creds.apiHash);
          memoryCache = null;
          return getApiCredentials();
        } catch {
          /* ignore */
        }
      }
    }
    return creds;
  })().finally(() => {
    bootstrapPromise = null;
  });

  return bootstrapPromise;
}

/** Write JSON under worker/temp via Rust (no python -c). */
export async function writeWorkerTempJson(
  namePrefix: string,
  data: unknown
): Promise<string> {
  const fname = `${namePrefix}_${Date.now()}.json`;
  const contents = JSON.stringify(data);
  if (!detectTauriRuntime()) {
    throw new Error('writeWorkerTempJson requires desktop app');
  }
  try {
    const path = await invoke<string>('write_worker_temp_file', {
      filename: fname,
      contents,
    });
    if (path) return path;
    throw new Error('Rust returned an empty temp-file path');
  } catch (e) {
    console.warn('write_worker_temp_file failed', e);
    const detail = String((e as Error)?.message || e || 'unknown IPC error');
    throw new Error(`write_worker_temp_file failed: ${detail}`);
  }
}

/** Best-effort delete under worker/temp after transfer jobs. */
export async function deleteWorkerTempFile(path: string | null | undefined): Promise<void> {
  if (!path || !detectTauriRuntime()) return;
  try {
    await invoke('delete_worker_temp_file', { path });
  } catch {
    /* ignore — job may already have cleaned up */
  }
}

export async function getSecureTransferSettings(): Promise<DriveTransferSettings | null> {
  const json = await invokeGet('autogram_drive_transfer_settings');
  if (!json) return null;
  try {
    return JSON.parse(json) as DriveTransferSettings;
  } catch {
    return null;
  }
}

export async function setSecureTransferSettings(settings: DriveTransferSettings): Promise<boolean> {
  return invokeSet('autogram_drive_transfer_settings', JSON.stringify(settings));
}
