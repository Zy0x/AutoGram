import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../tauri/platform';

export type DriveBetaStatus = {
  enabled: boolean;
  schemaVersion: number;
  driveCount: number;
  pendingEventCount: number;
  integrityOk: boolean;
};

export type DriveBetaDrive = {
  driveId: string;
  accountId: string;
  name: string;
  rootFolderId: string;
  storagePeerId?: string | null;
  storageTopicId?: number | null;
  state: 'active' | 'syncing' | 'error' | 'deleted';
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type DriveBetaFolder = {
  folderId: string;
  driveId: string;
  parentId?: string | null;
  name: string;
  version: number;
  objectHash: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};

export type DriveBetaDrivePage = {
  accountId: string;
  drives: DriveBetaDrive[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type DriveBetaFolderPage = {
  driveId: string;
  parentId: string;
  folders: DriveBetaFolder[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type DriveBetaIntegrity = {
  ok: boolean;
  systemIntegrity: string;
  metadataIntegrity: string;
  orphanFolderCount: number;
  missingRootCount: number;
  danglingMappingCount: number;
};

function requireDesktop() {
  if (!detectTauriRuntime()) throw new Error('DRIVE_BETA_DESKTOP_REQUIRED');
}

export async function driveBetaStatus(): Promise<DriveBetaStatus> {
  requireDesktop();
  return invoke<DriveBetaStatus>('drive_beta_status');
}

export async function driveBetaCreateDrive(request: {
  accountId: string;
  name: string;
  storagePeerId?: string | null;
  storageTopicId?: number | null;
  deviceId?: string | null;
}): Promise<DriveBetaDrive> {
  requireDesktop();
  return invoke<DriveBetaDrive>('drive_beta_create_drive', { request });
}

export async function driveBetaListDrives(request: {
  accountId: string;
  limit?: number;
  offset?: number;
}): Promise<DriveBetaDrivePage> {
  requireDesktop();
  return invoke<DriveBetaDrivePage>('drive_beta_list_drives', { request });
}

export async function driveBetaCreateFolder(request: {
  accountId: string;
  driveId: string;
  parentId?: string | null;
  name: string;
  deviceId?: string | null;
}): Promise<DriveBetaFolder> {
  requireDesktop();
  return invoke<DriveBetaFolder>('drive_beta_create_folder', { request });
}

export async function driveBetaListChildren(request: {
  accountId: string;
  driveId: string;
  parentId?: string | null;
  limit?: number;
  offset?: number;
}): Promise<DriveBetaFolderPage> {
  requireDesktop();
  return invoke<DriveBetaFolderPage>('drive_beta_list_children', { request });
}

export async function driveBetaRenameFolder(request: {
  accountId: string;
  driveId: string;
  folderId: string;
  name: string;
  deviceId?: string | null;
}): Promise<DriveBetaFolder> {
  requireDesktop();
  return invoke<DriveBetaFolder>('drive_beta_rename_folder', { request });
}

export async function driveBetaMoveFolder(request: {
  accountId: string;
  driveId: string;
  folderId: string;
  parentId: string;
  deviceId?: string | null;
}): Promise<DriveBetaFolder> {
  requireDesktop();
  return invoke<DriveBetaFolder>('drive_beta_move_folder', { request });
}

export async function driveBetaSoftDeleteFolder(request: {
  accountId: string;
  driveId: string;
  folderId: string;
  deviceId?: string | null;
}): Promise<number> {
  requireDesktop();
  return invoke<number>('drive_beta_soft_delete_folder', { request });
}

export async function driveBetaCreateSnapshot(request: {
  accountId: string;
  driveId: string;
  deviceId?: string | null;
}): Promise<{
  snapshotId: string;
  driveId: string;
  payloadHash: string;
  createdAt: number;
  folderCount: number;
  mappingCount: number;
}> {
  requireDesktop();
  return invoke('drive_beta_create_snapshot', { request });
}

export async function driveBetaIntegrityReport(): Promise<DriveBetaIntegrity> {
  requireDesktop();
  return invoke<DriveBetaIntegrity>('drive_beta_integrity_report');
}
