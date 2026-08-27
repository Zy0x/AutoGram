/**
 * Jobs CRUD via Rust SQLite (no Python daemon).
 * Migration execute still may surface a clear "runner WIP" until full Grammers transfer lands.
 */
import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../tauri/platform';

export type JobRow = {
  id: number;
  jobName?: string | null;
  profileName?: string | null;
  sourceEntityId?: string | null;
  targetEntityId?: string | null;
  transferMode?: string | null;
  configJson?: string | null;
  createdAt?: string | null;
  status?: string | null;
  processedMessages?: number | null;
  totalMessages?: number | null;
  lastProcessedId?: number | null;
  lastExecutionId?: number | null;
  // snake_case aliases from older payloads
  job_name?: string | null;
  profile_name?: string | null;
  source_entity_id?: string | null;
  target_entity_id?: string | null;
  transfer_mode?: string | null;
  config_json?: string | null;
  created_at?: string | null;
  processed_messages?: number | null;
  total_messages?: number | null;
  last_processed_id?: number | null;
  last_execution_id?: number | null;
};

function normalizeJob(j: JobRow): any {
  return {
    id: j.id,
    job_name: j.jobName ?? j.job_name ?? null,
    profile_name: j.profileName ?? j.profile_name ?? null,
    source_entity_id: j.sourceEntityId ?? j.source_entity_id ?? null,
    target_entity_id: j.targetEntityId ?? j.target_entity_id ?? null,
    transfer_mode: j.transferMode ?? j.transfer_mode ?? null,
    config_json: j.configJson ?? j.config_json ?? null,
    created_at: j.createdAt ?? j.created_at ?? null,
    status: j.status ?? null,
    processed_messages: j.processedMessages ?? j.processed_messages ?? null,
    total_messages: j.totalMessages ?? j.total_messages ?? null,
    last_processed_id: j.lastProcessedId ?? j.last_processed_id ?? null,
    last_execution_id: j.lastExecutionId ?? j.last_execution_id ?? null,
  };
}

export async function jobsList(): Promise<any[]> {
  if (!detectTauriRuntime()) return [];
  const rows = await invoke<JobRow[]>('jobs_list');
  return (rows || []).map(normalizeJob);
}

export async function jobsCreate(config: {
  source?: string;
  destination?: string;
  session?: string;
  mode?: string;
  jobName?: string;
  [k: string]: unknown;
}): Promise<number> {
  if (!detectTauriRuntime()) throw new Error('Jobs membutuhkan desktop app');
  const id = await invoke<number>('jobs_create', {
    request: {
      source: String(config.source || '0'),
      destination: String(config.destination || '0'),
      session: String(config.session || 'Lavender'),
      mode: String(config.mode || 'Clean Copy'),
      configJson: JSON.stringify(config),
      jobName: config.jobName ? String(config.jobName) : null,
    },
  });
  return Number(id);
}

export async function jobsEdit(
  jobId: number,
  config: {
    source?: string;
    destination?: string;
    session?: string;
    mode?: string;
    jobName?: string;
    [k: string]: unknown;
  }
): Promise<void> {
  if (!detectTauriRuntime()) throw new Error('Jobs membutuhkan desktop app');
  await invoke('jobs_edit', {
    request: {
      jobId,
      source: String(config.source || '0'),
      destination: String(config.destination || '0'),
      session: String(config.session || 'Lavender'),
      mode: String(config.mode || 'Clean Copy'),
      configJson: JSON.stringify(config),
      jobName: config.jobName ? String(config.jobName) : null,
    },
  });
}

export async function jobsDelete(jobId: number): Promise<void> {
  if (!detectTauriRuntime()) throw new Error('Jobs membutuhkan desktop app');
  await invoke('jobs_delete', { jobId });
}

export async function jobsStartExecution(jobId: number): Promise<number> {
  if (!detectTauriRuntime()) throw new Error('Jobs membutuhkan desktop app');
  return Number(await invoke<number>('jobs_start_execution', { jobId }));
}

export async function jobsRunMigration(args: {
  jobId: number;
  apiId: number;
  apiHash: string;
  maxMessages?: number;
}): Promise<{
  status: string;
  jobId: number;
  executionId: number;
  forwarded: number;
  skipped: number;
  failed: number;
  message: string;
  backend: string;
  mode: string;
}> {
  if (!detectTauriRuntime()) throw new Error('Jobs membutuhkan desktop app');
  return invoke('jobs_run_migration', {
    jobId: args.jobId,
    apiId: args.apiId,
    apiHash: args.apiHash,
    maxMessages: args.maxMessages ?? 100,
  });
}

export async function jobsDryRun(args: {
  jobId: number;
  apiId: number;
  apiHash: string;
}): Promise<{
  status: string;
  jobId: number;
  executionId: number;
  forwarded: number;
  skipped: number;
  failed: number;
  message: string;
  backend: string;
  mode: string;
}> {
  if (!detectTauriRuntime()) throw new Error('Jobs membutuhkan desktop app');
  return invoke('jobs_dry_run', {
    jobId: args.jobId,
    apiId: args.apiId,
    apiHash: args.apiHash,
  });
}

export async function jobsCancelMigration(jobId: number): Promise<void> {
  if (!detectTauriRuntime()) throw new Error('Jobs membutuhkan desktop app');
  await invoke('jobs_cancel_migration', { jobId });
}

export type NativeJobEvent = {
  id: number;
  job_id: number;
  timestamp: number;
  stage: string;
  message: string;
  metadata?: string | null;
};

export async function jobsGetEvents(jobId: number): Promise<NativeJobEvent[]> {
  if (!detectTauriRuntime()) return [];
  return invoke<NativeJobEvent[]>('autogram_get_job_events', { jobId });
}

export interface CacheSizeResult {
  bytes: number;
  cacheBytes: number;
  tempBytes: number;
  thumbsBytes: number;
  sysTempBytes: number;
  staleBytes: number;
  path: string;
  customPath: string | null;
  isFallback: boolean;
}

export async function cacheCalculateSize(): Promise<CacheSizeResult> {
  if (!detectTauriRuntime()) {
    return {
      bytes: 0,
      cacheBytes: 0,
      tempBytes: 0,
      thumbsBytes: 0,
      sysTempBytes: 0,
      staleBytes: 0,
      path: '',
      customPath: null,
      isFallback: false,
    };
  }
  const r = await invoke<any>('cache_calculate_size');
  return {
    bytes: Number(r?.bytes || 0),
    cacheBytes: Number(r?.cacheBytes || 0),
    tempBytes: Number(r?.tempBytes || 0),
    thumbsBytes: Number(r?.thumbsBytes || 0),
    sysTempBytes: Number(r?.sysTempBytes || 0),
    staleBytes: Number(r?.staleBytes || 0),
    path: String(r?.path || ''),
    customPath: r?.customPath ? String(r.customPath) : null,
    isFallback: Boolean(r?.isFallback),
  };
}

export interface CacheClearResult {
  status: 'success' | 'partial';
  removedFiles: number;
  freedBytes: number;
  remainingBytes: number;
  failedPaths: string[];
  cancelledStreams: number;
  clearedRegistryEntries: number;
}

export async function cacheClearDisk(): Promise<CacheClearResult> {
  if (!detectTauriRuntime()) {
    return {
      status: 'success', removedFiles: 0, freedBytes: 0, remainingBytes: 0,
      failedPaths: [], cancelledStreams: 0, clearedRegistryEntries: 0,
    };
  }
  const r = await invoke<any>('cache_clear_disk');
  return {
    status: r?.status === 'partial' ? 'partial' : 'success',
    removedFiles: Number(r?.removedFiles || 0),
    freedBytes: Number(r?.freedBytes || 0),
    remainingBytes: Number(r?.remainingBytes || 0),
    failedPaths: Array.isArray(r?.failedPaths) ? r.failedPaths.map(String) : [],
    cancelledStreams: Number(r?.cancelledStreams || 0),
    clearedRegistryEntries: Number(r?.clearedRegistryEntries || 0),
  };
}

export async function cacheTrimDisk(targetBytes: number): Promise<{ removed_files: number; freed_bytes: number }> {
  if (!detectTauriRuntime()) return { removed_files: 0, freed_bytes: 0 };
  const r = await invoke<{ removed_files?: number; freed_bytes?: number }>('cache_trim_disk', { targetBytes });
  return {
    removed_files: Number(r?.removed_files || 0),
    freed_bytes: Number(r?.freed_bytes || 0),
  };
}

export async function cacheSetPolicy(
  limitBytes: number,
  autoPrune: boolean
): Promise<{ limit_satisfied?: boolean; remaining_bytes?: number; removed_files?: number; freed_bytes?: number }> {
  if (!detectTauriRuntime()) return { limit_satisfied: true, remaining_bytes: 0 };
  return invoke('cache_trim_disk', {
    targetBytes: limitBytes,
    autoPrune,
    persistPolicy: true,
  });
}

export async function getAvailableDiskSpace(path?: string): Promise<{ free_bytes: number; total_bytes: number }> {
  if (!detectTauriRuntime()) return { free_bytes: 0, total_bytes: 0 };
  try {
    const r = await invoke<{ free_bytes?: number; total_bytes?: number }>('get_available_disk_space', { path });
    return {
      free_bytes: Number(r?.free_bytes || 0),
      total_bytes: Number(r?.total_bytes || 0),
    };
  } catch (err) {
    console.warn('Failed to get available disk space', err);
    return { free_bytes: 0, total_bytes: 0 };
  }
}

export interface CustomCacheDirInfo {
  customPath: string | null;
  activePath: string;
  isFallback: boolean;
  defaultPath: string;
}

export async function getCustomCacheDir(): Promise<CustomCacheDirInfo> {
  if (!detectTauriRuntime()) {
    return { customPath: null, activePath: '', isFallback: false, defaultPath: '' };
  }
  return invoke<CustomCacheDirInfo>('get_custom_cache_dir');
}

export async function setCustomCacheDir(newPath: string, action: 'move' | 'wipe'): Promise<CustomCacheDirInfo> {
  if (!detectTauriRuntime()) throw new Error('Fitur ini membutuhkan aplikasi desktop');
  return invoke<CustomCacheDirInfo>('set_custom_cache_dir', { newPath, action });
}

export async function resetCustomCacheDir(): Promise<CustomCacheDirInfo> {
  if (!detectTauriRuntime()) throw new Error('Fitur ini membutuhkan aplikasi desktop');
  return invoke<CustomCacheDirInfo>('reset_custom_cache_dir');
}

export async function jobsFreshStart(jobId: number): Promise<void> {
  if (!detectTauriRuntime()) throw new Error('Jobs membutuhkan desktop app');
  await invoke('jobs_fresh_start', { jobId });
}

export async function jobsExportJson(): Promise<string> {
  if (!detectTauriRuntime()) throw new Error('Jobs membutuhkan desktop app');
  return invoke<string>('jobs_export_json');
}

export async function jobsImportJson(json: string): Promise<number> {
  if (!detectTauriRuntime()) throw new Error('Jobs membutuhkan desktop app');
  return Number(await invoke<number>('jobs_import_json', { json }));
}

/** Normalize job row for UI (camel + snake). */
export function jobDisplayName(job: any): string {
  return String(job?.job_name || job?.jobName || job?.name || `Job #${job?.id || '?'}`);
}
