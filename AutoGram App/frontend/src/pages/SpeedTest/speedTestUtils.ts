/** LocalStorage Keys for Drive Workbench */
export const LS_VIEW = 'autogram_drive_view';
export const LS_COLLAPSE = 'autogram_drive_rail';
export const LS_SORT = 'autogram_drive_sort';
export const LS_THUMB_Q = 'autogram_drive_thumb_q';
export const LS_GRID_ZOOM = 'autogram_drive_grid_zoom';
export const LS_TM_MIN = 'autogram_transfer_minimized';
export const LS_SESSION = 'autogram_drive_session';
export const LS_SESSIONS_CACHE = 'autogram_drive_sessions_cache';

export interface QueueTask {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'paused';
  speed?: string;
  eta?: string;
  error?: string;
  type: 'upload' | 'download';
}

export type LocationKind = 'saved' | 'drive' | 'chat';

export type SpeedTestProps = {
  onExitToApp?: () => void;
};

export function readSessionsCache(): string[] {
  try {
    const raw = localStorage.getItem(LS_SESSIONS_CACHE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function writeSessionsCache(list: string[]): void {
  try {
    localStorage.setItem(LS_SESSIONS_CACHE, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
