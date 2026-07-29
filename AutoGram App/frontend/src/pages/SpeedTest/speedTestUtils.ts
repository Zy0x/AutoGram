export interface SpeedTestProps {
  onExitToApp?: () => void;
}

export const LS_SESSION = 'autogram_drive_session';

export function readSessionsCache(): string[] {
  try {
    const raw = localStorage.getItem('autogram_drive_sessions_cache');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function writeSessionsCache(list: string[]) {
  try {
    localStorage.setItem('autogram_drive_sessions_cache', JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
