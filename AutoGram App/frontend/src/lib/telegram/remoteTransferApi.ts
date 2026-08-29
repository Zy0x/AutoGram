import { invoke } from '@tauri-apps/api/core';

export type RemoteTransferMode = 'auto' | 'cloud_fetch' | 'storage_local';
export type StorageLocalPolicy = 'telegram' | 'custom_disk' | 'disk_and_telegram';

export interface RemotePreflightRequest {
  url: string;
  customFilename?: string | null;
  destinationId?: string | null;
  topicId?: number | null;
  mode?: RemoteTransferMode | null;
  storagePolicy?: StorageLocalPolicy | null;
  customDiskPath?: string | null;
}

export interface RemotePreflightReport {
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number | null;
  etag?: string | null;
  thumbnailUrl?: string | null;
  recommendedMode: string;
  resolvedMode: string;
  storagePolicy: string;
  spoolPath: string;
  requiredDiskBytes: number;
  availableDiskBytes?: number | null;
  hasSufficientDisk: boolean;
  estimatedDownloadQuotaBytes: number;
  estimatedUploadQuotaBytes: number;
  supportsHttpRangeResume: boolean;
  cloudFetchEligible: boolean;
  retentionPolicyLabel: string;
}

export interface RemoteTransferJob {
  jobId: string;
  accountId?: string | null;
  sourceUrl: string;
  sourceFilename?: string | null;
  sourceMime?: string | null;
  sourceSize?: number | null;
  sourceEtag?: string | null;
  sourceLastModified?: string | null;
  thumbnailUrl?: string | null;
  mode: RemoteTransferMode;
  storagePolicy: StorageLocalPolicy;
  customDiskPath?: string | null;
  spoolPath?: string | null;
  downloadedBytes: number;
  uploadedBytes: number;
  checksumSha256?: string | null;
  destinationType?: string | null;
  destinationId?: string | null;
  destinationTopicId?: number | null;
  telegramMessageId?: number | null;
  state: string;
  cleanupState: string;
  retryCount: number;
  lastError?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs?: number | null;
}

export interface RemoteRecoveryItem {
  jobId: string;
  sourceUrl: string;
  filename: string;
  downloadedBytes: number;
  totalSizeBytes?: number | null;
  partPath: string;
  manifestPath: string;
  state: string;
  createdAtMs: number;
  reason: string;
  canResume: boolean;
}

export async function remoteTransferPreflight(
  request: RemotePreflightRequest
): Promise<RemotePreflightReport> {
  return await invoke<RemotePreflightReport>('remote_transfer_preflight', { request });
}

export async function remoteTransferCreate(
  job: RemoteTransferJob
): Promise<string> {
  return await invoke<string>('remote_transfer_create', { job });
}

export async function remoteTransferPause(jobId: string): Promise<void> {
  return await invoke<void>('remote_transfer_pause', { jobId });
}

export async function remoteTransferResume(
  jobId: string,
  session: string,
  apiId: number,
  apiHash: string
): Promise<unknown> {
  return await invoke('remote_transfer_resume', {
    jobId,
    session,
    apiId,
    apiHash,
  });
}

export async function remoteTransferCancel(jobId: string): Promise<void> {
  return await invoke<void>('remote_transfer_cancel', { jobId });
}

export async function remoteTransferCleanup(jobId: string): Promise<void> {
  return await invoke<void>('remote_transfer_cleanup', { jobId });
}

export async function remoteTransferListRecovery(): Promise<RemoteRecoveryItem[]> {
  return await invoke<RemoteRecoveryItem[]>('remote_transfer_list_recovery');
}

export async function remoteTransferGetJob(
  jobId: string
): Promise<RemoteTransferJob | null> {
  return await invoke<RemoteTransferJob | null>('remote_transfer_get_job', { jobId });
}
