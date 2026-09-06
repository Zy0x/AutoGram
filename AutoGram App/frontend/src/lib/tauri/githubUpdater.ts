import { useState, useEffect, useCallback, useRef } from 'react';
import i18n from '../../i18n';

export const CURRENT_APP_VERSION = '3.9.72';
export const GITHUB_REPO_URL = 'https://github.com/Zy0x/AutoGram';
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases/latest`;
export const GITHUB_API_LATEST_RELEASE =
  'https://api.github.com/repos/Zy0x/AutoGram/releases/latest';
export const GITHUB_API_ALL_RELEASES =
  'https://api.github.com/repos/Zy0x/AutoGram/releases';

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // 6 hours
const MANUAL_COOLDOWN_MS     = 5 * 60 * 1000;         // 5 minutes
const LS_LAST_CHECK_KEY      = 'ag_upd_last';          // timestamp of last successful check
const LS_LAST_RESULT_KEY     = 'ag_upd_res';           // cached result (tag + url)

export type ReleaseChannel = 'stable' | 'beta';

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
  autoInstallOnExit: boolean;
  notifyOnUpdate: boolean;
  releaseChannel: ReleaseChannel;
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
  channel: ReleaseChannel;
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

function saveCache(tag: string, url: string, channel: ReleaseChannel): void {
  try {
    const entry: CachedResult = { tag, url, checkedAt: Date.now(), channel };
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
  setAutoInstallOnExit: (enabled: boolean) => void;
  setNotifyOnUpdate: (enabled: boolean) => void;
  setReleaseChannel: (channel: ReleaseChannel) => void;
} {
  const [releaseChannel, setReleaseChannelState] = useState<ReleaseChannel>(() => {
    const saved = localStorage.getItem('autogram_release_channel');
    return (saved === 'beta' ? 'beta' : 'stable') as ReleaseChannel;
  });

  const [status, setStatus] = useState<UpdateStatus>(() => {
    const cache = loadCache();
    if (cache && cache.channel === releaseChannel) {
      return compareVersions(cache.tag, CURRENT_APP_VERSION) > 0
        ? 'updateAvailable'
        : 'upToDate';
    }
    return 'upToDate';
  });

  const [latestVersion, setLatestVersion] = useState<string>(() => {
    const cache = loadCache();
    return cache ? cache.tag : `v${CURRENT_APP_VERSION}`;
  });

  const [releaseUrl, setReleaseUrl] = useState<string>(() => {
    const cache = loadCache();
    return cache ? cache.url : GITHUB_RELEASES_URL;
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

  const [autoInstallOnExit, setAutoInstallOnExitState] = useState<boolean>(() => {
    const saved = localStorage.getItem('autogram_auto_install_on_exit');
    return saved === null ? false : saved === 'true';
  });

  const [notifyOnUpdate, setNotifyOnUpdateState] = useState<boolean>(() => {
    const saved = localStorage.getItem('autogram_notify_on_update');
    return saved === null ? true : saved === 'true';
  });

  const lastManualCheckRef = useRef<number>(0);
  const didInitialCheckRef = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setAutoCheck = useCallback((enabled: boolean) => {
    setAutoCheckState(enabled);
    localStorage.setItem('autogram_auto_check_updates', String(enabled));
  }, []);

  const setAutoDownload = useCallback((enabled: boolean) => {
    setAutoDownloadState(enabled);
    localStorage.setItem('autogram_auto_download_updates', String(enabled));
  }, []);

  const setAutoInstallOnExit = useCallback((enabled: boolean) => {
    setAutoInstallOnExitState(enabled);
    localStorage.setItem('autogram_auto_install_on_exit', String(enabled));
  }, []);

  const setNotifyOnUpdate = useCallback((enabled: boolean) => {
    setNotifyOnUpdateState(enabled);
    localStorage.setItem('autogram_notify_on_update', String(enabled));
  }, []);

  const setReleaseChannel = useCallback((channel: ReleaseChannel) => {
    setReleaseChannelState(channel);
    localStorage.setItem('autogram_release_channel', channel);
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

  const performCheck = useCallback(async (isManual: boolean): Promise<void> => {
    setIsChecking(true);
    setStatus('checking');
    setErrorMessage(null);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const endpoint = releaseChannel === 'beta'
        ? GITHUB_API_ALL_RELEASES
        : GITHUB_API_LATEST_RELEASE;

      let res: Response;
      try {
        res = await fetch(endpoint, {
          signal: controller.signal,
          headers: { Accept: 'application/vnd.github.v3+json' },
          cache: 'no-store',
        });
      } finally {
        clearTimeout(timeoutId);
      }

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

      if (res.status === 200) {
        let tag = `v${CURRENT_APP_VERSION}`;
        let url = GITHUB_RELEASES_URL;

        if (releaseChannel === 'beta') {
          const releases = (await res.json()) as Array<{ tag_name?: string; html_url?: string }>;
          if (Array.isArray(releases) && releases.length > 0) {
            tag = String(releases[0].tag_name || tag).trim();
            url = releases[0].html_url || GITHUB_RELEASES_URL;
          }
        } else {
          const data = (await res.json()) as { tag_name?: string; html_url?: string };
          tag = data.tag_name ? String(data.tag_name).trim() : tag;
          url = data.html_url || GITHUB_RELEASES_URL;
        }

        setLatestVersion(tag);
        setReleaseUrl(url);
        saveCache(tag, url, releaseChannel);
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

      const cache = loadCache();
      if (cache) {
        setLatestVersion(cache.tag);
        setReleaseUrl(cache.url);
      }
      setStatus('upToDate');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('aborted') || msg.includes('timeout');
      setStatus('networkError');
      setErrorMessage(
        isTimeout
          ? i18n.t('settings.update_timeout_error')
          : i18n.t('settings.update_network_error')
      );
      const cache = loadCache();
      if (cache) {
        setLatestVersion(cache.tag);
        setReleaseUrl(cache.url);
      }
    } finally {
      setIsChecking(false);
    }
  }, [autoDownload, releaseChannel, startDownload]);

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

  const scheduleNextCheck = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void performCheck(false);
      scheduleNextCheck();
    }, AUTO_CHECK_INTERVAL_MS);
  }, [performCheck]);

  useEffect(() => {
    if (!autoCheck) {
      setStatus('upToDate');
      return;
    }
    if (didInitialCheckRef.current) return;
    didInitialCheckRef.current = true;

    const wait = msUntilNextAutoCheck();
    if (wait === 0) {
      void performCheck(false);
      scheduleNextCheck();
    } else {
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
    autoInstallOnExit,
    notifyOnUpdate,
    releaseChannel,
    lastCheckedAt,
    errorMessage,
    checkNow,
    startDownload,
    installUpdate,
    setAutoCheck,
    setAutoDownload,
    setAutoInstallOnExit,
    setNotifyOnUpdate,
    setReleaseChannel,
  };
}
