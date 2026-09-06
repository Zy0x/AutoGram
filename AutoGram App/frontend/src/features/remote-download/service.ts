import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';
import type { RemoteMuxSpec } from '../../lib/telegram/linkResolvers';

export interface LocalDownloadRequest {
  url: string; filename: string; directory: string; connections: number; mux?: RemoteMuxSpec | null;
}
export interface LocalDownloadSnapshot {
  id: string; filename: string; directory: string;
  state: 'queued' | 'downloading' | 'paused' | 'cancelling' | 'cancelled' | 'done' | 'failed';
  phase: 'download' | 'mux' | 'verify'; downloaded: number; total: number; outputBytes: number; error?: string;
}
export const isLocalDownloadTerminal = (state: LocalDownloadSnapshot['state']) => ['done', 'failed', 'cancelled'].includes(state);
type LocalState = { jobs: LocalDownloadSnapshot[]; error: string; hidden: boolean };
let state: LocalState = { jobs: [], error: '', hidden: false };
const subscribers = new Set<() => void>();
function subscribe(listener: () => void) { subscribers.add(listener); return () => { subscribers.delete(listener); }; }
export function useLocalDownloads() { return useSyncExternalStore(subscribe, () => state); }
useLocalDownloads.setState = (partial: Partial<LocalState>) => {
  state = { ...state, ...partial };
  subscribers.forEach(listener => listener());
};
export async function startLocalDownloads(requests: LocalDownloadRequest[]): Promise<boolean> {
  const jobs = await invoke<LocalDownloadSnapshot[]>('remote_download_start', { requests });
  useLocalDownloads.setState({ jobs, error: '', hidden: false });
  return true;
}
export async function refreshLocalDownloads() {
  const jobs = await invoke<LocalDownloadSnapshot[]>('remote_download_list');
  useLocalDownloads.setState({ jobs });
}
export async function controlLocalDownload(id: string, action: 'pause' | 'resume' | 'cancel') {
  try {
    await invoke('remote_download_control', { id, action });
    await refreshLocalDownloads();
    useLocalDownloads.setState({ error: '' });
  } catch { useLocalDownloads.setState({ error: 'control' }); }
}
