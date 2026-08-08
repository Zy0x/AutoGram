import { useState, useEffect, useCallback, useRef } from 'react';

export const CURRENT_APP_VERSION = '2.1.3';
export const GITHUB_REPO_URL = 'https://github.com/Zy0x/AutoGram';
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases/latest`;
export const GITHUB_API_LATEST_RELEASE =
  'https://api.github.com/repos/Zy0x/AutoGram/releases/latest';

// ── Rate-limit guard ─────────────────────────────────────────────────────────
// GitHub unauthenticated API = 60 req/hour. We enforce a minimum interval of
// 6 hours between automatic checks, and 5 minutes between manual re-checks.
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6 hours
const MANUAL_COOLDOWN_MS     = 5 * 60 * 1000;         // 5 minutes
const LS_LAST_CHECK_KEY      = 'ag_upd_last';          // timestamp of last successful check
const LS_LAST_RESULT_KEY     = 'ag_upd_res';           // cached result (tag + url)

export type UpdateStatus =
  | 'checking'
  | 'upToDate'
  | 'updateAvailable'
  | 'downloading'
  | 'readyToInstall'
  | 'installing'
  | 'rateLimited'
  | 'networkError'
  | 'error';

export interface UpdateInfo {
  status: UpdateStatus;
  latestVersion: string;
  releaseUrl: string;
  isChecking: boolean;
  downloadProgress: number;
  autoCheck: boolean;
  autoDownload: boolean;
  lastCheckedAt: number | null; // unix ms
  errorMessage: string | null;
}

function compareVersions(v1: string, v2: string): number {
  const clean = (v: string) => v.replace(/^v/i, '').trim();
  const parts1 = clean(v1).split('.').map(Number);
  const parts2 = clean(v2).split('.').map(Number);
  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

interface CachedResult {
  tag: string;
  url: string;
  checkedAt: number;
}

function loadCache(): CachedResult | null {
  try {
    const raw = localStorage.getItem(LS_LAST_RESULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedResult;
  } catch {
    return null;
  }
}

function saveCache(tag: string, url: string): void {
  try {
    const entry: CachedResult = { tag, url, checkedAt: Date.now() };
    localStorage.setItem(LS_LAST_RESULT_KEY, JSON.stringify(entry));
    localStorage.setItem(LS_LAST_CHECK_KEY, String(entry.checkedAt));
  } catch { /* ignore */ }
}

function msUntilNextAutoCheck(): number {
  try {
    const last = Number(localStorage.getItem(LS_LAST_CHECK_KEY) || '0');
    if (!last) return 0;
    const elapsed = Date.now() - last;
    return Math.max(0, AUTO_CHECK_INTERVAL_MS - elapsed);
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export function useGitHubUpdater(): UpdateInfo & {
  checkNow: () => Promise<void>;
  startDownload: () => Promise<void>;
  installUpdate: () => Promise<void>;
  setAutoCheck: (enabled: boolean) => void;
  setAutoDownload: (enabled: boolean) => void;
} {
  const [status, setStatus] = useState<UpdateStatus>(() => {
    // If we have a cached result and it is recent, start with it immediately
    const cache = loadCache();
    if (cache) {
      return compareVersions(cache.tag, CURRENT_APP_VERSION) > 0
        ? 'updateAvailable'
        : 'upToDate';
    }
    return 'upToDate';
  });

  const [latestVersion, setLatestVersion] = useState<string>(() => {
    return loadCache()?.tag ?? `v${CURRENT_APP_VERSION}`;
  });

  const [releaseUrl, setReleaseUrl] = useState<string>(() => {
    return loadCache()?.url ?? GITHUB_RELEASES_URL;
  });

  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(LS_LAST_CHECK_KEY) || '0');
    return v || null;
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [autoCheck, setAutoCheckState] = useState<boolean>(() => {
    const saved = localStorage.getItem('autogram_auto_check_updates');
    return saved === null ? true : saved === 'true';
  });

  const [autoDownload, setAutoDownloadState] = useState<boolean>(() => {
    const saved = localStorage.getItem('autogram_auto_download_updates');
    return saved === null ? false : saved === 'true';
  });

  // Track last manual check time for per-session cooldown
  const lastManualCheckRef = useRef<number>(0);
  // Track if component already did its initial auto-check this session
  const didInitialCheckRef = useRef<boolean>(false);
  // Track scheduled timer for periodic re-check
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setAutoCheck = useCallback((enabled: boolean) => {
    setAutoCheckState(enabled);
    localStorage.setItem('autogram_auto_check_updates', String(enabled));
  }, []);

  const setAutoDownload = useCallback((enabled: boolean) => {
    setAutoDownloadState(enabled);
    localStorage.setItem('autogram_auto_download_updates', String(enabled));
  }, []);

  const startDownload = useCallback(async () => {
    setStatus('downloading');
    setDownloadProgress(0);
    for (let p = 10; p <= 100; p += 15) {
      await new Promise((r) => setTimeout(r, 200));
      setDownloadProgress(Math.min(p, 100));
    }
    setStatus('readyToInstall');
  }, []);

  const installUpdate = useCallback(async () => {
    setStatus('installing');
    await new Promise((r) => setTimeout(r, 600));
    window.location.reload();
  }, []);

  // Core fetch — shared by auto + manual paths
  const performCheck = useCallback(async (isManual: boolean): Promise<void> => {
    setIsChecking(true);
    setStatus('checking');
    setErrorMessage(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout

      let res: Response;
      try {
        res = await fetch(GITHUB_API_LATEST_RELEASE, {
          signal: controller.signal,
          headers: { Accept: 'application/vnd.github.v3+json' },
          cache: 'no-store',
        });
      } finally {
        clearTimeout(timeoutId);
      }

      // ── Rate limited
      if (res.status === 403 || res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        const resetTime  = res.headers.get('x-ratelimit-reset');
        let waitMsg = '';
        if (retryAfter) waitMsg = ` (retry after ${retryAfter}s)`;
        else if (resetTime) {
          const d = new Date(Number(resetTime) * 1000);
          waitMsg = ` (resets at ${d.toLocaleTimeString()})`;
        }
        setStatus('rateLimited');
        setErrorMessage(`GitHub API rate limit reached${waitMsg}. Showing cached result.`);

        // Fall back to cache if available
        const cache = loadCache();
        if (cache) {
          setLatestVersion(cache.tag);
          setReleaseUrl(cache.url);
          setStatus(
            compareVersions(cache.tag, CURRENT_APP_VERSION) > 0
              ? 'updateAvailable'
              : 'upToDate'
          );
        }
        return;
      }

      // ── Server error (5xx) — show network error, preserve last known state
      if (res.status >= 500) {
        setStatus('networkError');
        setErrorMessage(`GitHub server error (${res.status}). Will retry later.`);
        const cache = loadCache();
        if (cache) {
          setLatestVersion(cache.tag);
          setReleaseUrl(cache.url);
        }
        return;
      }

      // ── Success
      if (res.status === 200) {
        const data = (await res.json()) as { tag_name?: string; html_url?: string };
        const tag = data.tag_name ? String(data.tag_name).trim() : `v${CURRENT_APP_VERSION}`;
        const url = data.html_url || GITHUB_RELEASES_URL;

        setLatestVersion(tag);
        setReleaseUrl(url);
        saveCache(tag, url);
        setLastCheckedAt(Date.now());

        if (compareVersions(tag, CURRENT_APP_VERSION) > 0) {
          if (!isManual && autoDownload) {
            void startDownload();
          } else {
            setStatus('updateAvailable');
          }
        } else {
          setStatus('upToDate');
        }
        return;
      }

      // ── Unexpected status (404, etc.) — treat as up-to-date, preserve cache
      const cache = loadCache();
      if (cache) {
        setLatestVersion(cache.tag);
        setReleaseUrl(cache.url);
      }
      setStatus('upToDate');
    } catch (err: unknown) {
      // Network error / timeout / abort
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('aborted') || msg.includes('timeout');
      setStatus('networkError');
      setErrorMessage(
        isTimeout
          ? 'Update check timed out. Check your internet connection.'
          : 'Could not reach GitHub. Check your internet connection.'
      );
      // Restore cached state so UI shows last known version
      const cache = loadCache();
      if (cache) {
        setLatestVersion(cache.tag);
        setReleaseUrl(cache.url);
      }
    } finally {
      setIsChecking(false);
    }
  }, [autoDownload, startDownload]);

  // Public checkNow — rate-guarded manual trigger
  const checkNow = useCallback(async () => {
    const now = Date.now();
    const sinceManual = now - lastManualCheckRef.current;
    if (sinceManual < MANUAL_COOLDOWN_MS) {
      const remaining = Math.ceil((MANUAL_COOLDOWN_MS - sinceManual) / 1000);
      setErrorMessage(`Please wait ${remaining}s before checking again.`);
      setStatus('upToDate');
      return;
    }
    lastManualCheckRef.current = now;
    await performCheck(true);
  }, [performCheck]);

  // Schedule the next periodic auto-check
  const scheduleNextCheck = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void performCheck(false);
      scheduleNextCheck(); // reschedule after each run
    }, AUTO_CHECK_INTERVAL_MS);
  }, [performCheck]);

  // On mount: do one initial check only if interval has elapsed, then schedule
  useEffect(() => {
    if (!autoCheck) {
      setStatus('upToDate');
      return;
    }
    if (didInitialCheckRef.current) return;
    didInitialCheckRef.current = true;

    const wait = msUntilNextAutoCheck();
    if (wait === 0) {
      // Interval elapsed — check now, then schedule repeat
      void performCheck(false);
      scheduleNextCheck();
    } else {
      // Not yet time — restore from cache and schedule future check
      const cache = loadCache();
      if (cache) {
        setLatestVersion(cache.tag);
        setReleaseUrl(cache.url);
        setStatus(
          compareVersions(cache.tag, CURRENT_APP_VERSION) > 0
            ? 'updateAvailable'
            : 'upToDate'
        );
      } else {
        setStatus('upToDate');
      }
      // Schedule for when interval actually elapses
      timerRef.current = setTimeout(() => {
        void performCheck(false);
        scheduleNextCheck();
      }, wait);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    latestVersion,
    releaseUrl,
    isChecking,
    downloadProgress,
    autoCheck,
    autoDownload,
    lastCheckedAt,
    errorMessage,
    checkNow,
    startDownload,
    installUpdate,
    setAutoCheck,
    setAutoDownload,
  };
}
