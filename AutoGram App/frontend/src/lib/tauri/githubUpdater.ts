import { useState, useEffect, useCallback } from 'react';

export const CURRENT_APP_VERSION = '2.1.3';
export const GITHUB_REPO_URL = 'https://github.com/Zy0x/AutoGram';
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases/latest`;
export const GITHUB_API_LATEST_RELEASE = 'https://api.github.com/repos/Zy0x/AutoGram/releases/latest';

export type UpdateStatus = 'checking' | 'upToDate' | 'updateAvailable' | 'error';

export interface UpdateInfo {
  status: UpdateStatus;
  latestVersion: string;
  releaseUrl: string;
  isChecking: boolean;
}

function compareVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/i, '').trim();
  const clean2 = v2.replace(/^v/i, '').trim();
  
  const parts1 = clean1.split('.').map(Number);
  const parts2 = clean2.split('.').map(Number);
  
  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export function useGitHubUpdater(): UpdateInfo & { checkNow: () => Promise<void> } {
  const [status, setStatus] = useState<UpdateStatus>('checking');
  const [latestVersion, setLatestVersion] = useState<string>(`v${CURRENT_APP_VERSION}`);
  const [releaseUrl, setReleaseUrl] = useState<string>(GITHUB_RELEASES_URL);
  const [isChecking, setIsChecking] = useState<boolean>(false);

  const checkNow = useCallback(async () => {
    setIsChecking(true);
    setStatus('checking');
    try {
      const res = await fetch(GITHUB_API_LATEST_RELEASE, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (res.status === 200) {
        const data = (await res.json()) as { tag_name?: string; html_url?: string };
        const tag = data.tag_name ? String(data.tag_name).trim() : `v${CURRENT_APP_VERSION}`;
        const url = data.html_url || GITHUB_RELEASES_URL;

        setLatestVersion(tag);
        setReleaseUrl(url);

        if (compareVersions(tag, CURRENT_APP_VERSION) > 0) {
          setStatus('updateAvailable');
        } else {
          setStatus('upToDate');
        }
      } else {
        // Fallback to up-to-date if no releases published yet
        setStatus('upToDate');
      }
    } catch {
      setStatus('upToDate');
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkNow();
  }, [checkNow]);

  return { status, latestVersion, releaseUrl, isChecking, checkNow };
}
