import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../../tauri/platform';

export type DriveEngineStatus = {
  enabled: boolean;
  schemaVersion: number;
  driveCount: number;
  pendingEventCount: number;
  integrityOk: boolean;
};

export type DriveEngineDrive = {
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

export type DriveEngineFolder = {
  folderId: string;
  driveId: string;
  parentId?: string | null;
  name: string;
  telegramChatId?: string | null;
  telegramTopicId?: number | null;
  version: number;
  objectHash: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};

export type DriveEngineLocation = {
  uiId: number;
  driveId: string;
  folderId: string;
  parentUiId: number | null;
  name: string;
  storagePeerId: number | null;
  storageTopicId: number | null;
  root: boolean;
};

const engineLocations = new Map<number, DriveEngineLocation>();
let engineLocationAccountId: string | null = null;

/** Stable negative UI handle; the UUID remains the canonical persisted identity. */
export function driveEngineUiId(uuid: string): number {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < uuid.length; index += 1) {
    hash ^= BigInt(uuid.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  const safe = Number(hash & 0x1fffffffffffffn) || 1;
  return -safe;
}

export function registerDriveEngineLocation(location: Omit<DriveEngineLocation, 'uiId'>): DriveEngineLocation {
  const uiId = driveEngineUiId(location.folderId);
  const resolved = { ...location, uiId };
  engineLocations.set(uiId, resolved);
  return resolved;
}

export function resolveDriveEngineLocation(uiId: number | null | undefined): DriveEngineLocation | null {
  if (uiId == null) return null;
  return engineLocations.get(Number(uiId)) ?? null;
}

export function resolveDriveEngineRoot(driveId: string): DriveEngineLocation | null {
  for (const location of engineLocations.values()) {
    if (location.driveId === driveId && location.root) return location;
  }
  return null;
}

export function driveEngineLocationSubtree(uiId: number): DriveEngineLocation[] {
  const root = resolveDriveEngineLocation(uiId);
  if (!root) return [];
  const result: DriveEngineLocation[] = [];
  const queue = [root.uiId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = engineLocations.get(currentId);
    if (!current) continue;
    result.push(current);
    for (const candidate of engineLocations.values()) {
      if (candidate.parentUiId === currentId) queue.push(candidate.uiId);
    }
  }
  return result;
}

export function clearDriveEngineLocations(): void {
  engineLocations.clear();
  engineLocationAccountId = null;
}

function activateDriveEngineAccount(accountId: string): void {
  if (engineLocationAccountId === accountId) return;
  engineLocations.clear();
  engineLocationAccountId = accountId;
}

export function driveEngineAccountId(session: string): string {
  return `session:${String(session || '').trim()}`;
}

export type DriveEngineDrivePage = {
  accountId: string;
  drives: DriveEngineDrive[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type DriveEngineFolderPage = {
  driveId: string;
  parentId: string;
  folders: DriveEngineFolder[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type DriveEngineFile = {
  fileId: string;
  driveId: string;
  folderId: string;
  filename: string;
  size: number;
  mime?: string | null;
  contentHash?: string | null;
  telegramUniqueId?: string | null;
  telegramChatId: string;
  telegramTopicId?: number | null;
  telegramMessageId: number;
  createdAt: number;
  updatedAt: number;
};

export type DriveEngineFilePage = {
  driveId: string;
  folderId: string;
  files: DriveEngineFile[];
  limit: number;
  offset: number;
  hasMore: boolean;
  totalCount: number;
  totalBytes: number;
};

export type DriveEngineIntegrity = {
  ok: boolean;
  systemIntegrity: string;
  metadataIntegrity: string;
  orphanFolderCount: number;
  missingRootCount: number;
  danglingMappingCount: number;
};

function requireDesktop() {
  if (!detectTauriRuntime()) throw new Error('DRIVE_ENGINE_DESKTOP_REQUIRED');
}

export async function driveEngineStatus(): Promise<DriveEngineStatus> {
  requireDesktop();
  return invoke<DriveEngineStatus>('drive_engine_status');
}

export async function driveEngineCreateDrive(request: {
  accountId: string;
  name: string;
  storagePeerId?: string | null;
  storageTopicId?: number | null;
  deviceId?: string | null;
}): Promise<DriveEngineDrive> {
  requireDesktop();
  return invoke<DriveEngineDrive>('drive_engine_create_drive', { request });
}

export async function driveEngineListDrives(request: {
  accountId: string;
  limit?: number;
  offset?: number;
}): Promise<DriveEngineDrivePage> {
  requireDesktop();
  return invoke<DriveEngineDrivePage>('drive_engine_list_drives', { request });
}

export async function driveEngineCreateFolder(request: {
  accountId: string;
  driveId: string;
  parentId?: string | null;
  name: string;
  telegramChatId?: string | null;
  telegramTopicId?: number | null;
  deviceId?: string | null;
}): Promise<DriveEngineFolder> {
  requireDesktop();
  return invoke<DriveEngineFolder>('drive_engine_create_folder', { request });
}

export async function driveEngineListChildren(request: {
  accountId: string;
  driveId: string;
  parentId?: string | null;
  limit?: number;
  offset?: number;
}): Promise<DriveEngineFolderPage> {
  requireDesktop();
  return invoke<DriveEngineFolderPage>('drive_engine_list_children', { request });
}

export async function driveEngineCommitFile(request: {
  accountId: string;
  driveId: string;
  folderId: string;
  filename: string;
  size: number;
  mime?: string | null;
  contentHash?: string | null;
  telegramUniqueId?: string | null;
  telegramChatId: string;
  telegramTopicId?: number | null;
  telegramMessageId: number;
  deviceId?: string | null;
}): Promise<DriveEngineFile> {
  requireDesktop();
  return invoke<DriveEngineFile>('drive_engine_commit_file', { request });
}

export async function driveEngineListFiles(request: {
  accountId: string;
  driveId: string;
  folderId: string;
  limit?: number;
  offset?: number;
  sortMode?: string;
  contentFilter?: string;
  telegramTopicId?: number | null;
}): Promise<DriveEngineFilePage> {
  requireDesktop();
  return invoke<DriveEngineFilePage>('drive_engine_list_files', { request });
}

export async function driveEngineSoftDeleteFiles(request: {
  accountId: string;
  driveId: string;
  folderId: string;
  telegramMessageIds: number[];
  deviceId?: string | null;
}): Promise<number> {
  requireDesktop();
  return invoke<number>('drive_engine_soft_delete_files', { request });
}

export async function driveEngineMoveFiles(request: {
  accountId: string;
  driveId: string;
  sourceFolderId: string;
  destinationFolderId: string;
  telegramMessageIds: number[];
  deviceId?: string | null;
}): Promise<number> {
  requireDesktop();
  return invoke<number>('drive_engine_move_files', { request });
}

export async function driveEngineRenameFolder(request: {
  accountId: string;
  driveId: string;
  folderId: string;
  name: string;
  deviceId?: string | null;
}): Promise<DriveEngineFolder> {
  requireDesktop();
  return invoke<DriveEngineFolder>('drive_engine_rename_folder', { request });
}

export async function driveEngineMoveFolder(request: {
  accountId: string;
  driveId: string;
  folderId: string;
  parentId: string;
  deviceId?: string | null;
}): Promise<DriveEngineFolder> {
  requireDesktop();
  return invoke<DriveEngineFolder>('drive_engine_move_folder', { request });
}

export async function driveEngineSoftDeleteFolder(request: {
  accountId: string;
  driveId: string;
  folderId: string;
  deviceId?: string | null;
}): Promise<number> {
  requireDesktop();
  return invoke<number>('drive_engine_soft_delete_folder', { request });
}

export async function driveEngineSoftDeleteDrive(request: {
  accountId: string;
  driveId: string;
  deviceId?: string | null;
}): Promise<number> {
  requireDesktop();
  return invoke<number>('drive_engine_soft_delete_drive', { request });
}

export async function driveEngineCreateSnapshot(request: {
  accountId: string;
  driveId: string;
  deviceId?: string | null;
}): Promise<{
  snapshotId: string;
  driveId: string;
  payloadHash: string;
  createdAt: number;
  folderCount: number;
  fileCount: number;
  mappingCount: number;
}> {
  requireDesktop();
  return invoke('drive_engine_create_snapshot', { request });
}

export async function driveEngineRestoreLatestSnapshot(request: {
  accountId: string;
  driveId: string;
}): Promise<{
  snapshotId: string;
  driveId: string;
  payloadHash: string;
  restoredFolderCount: number;
  restoredFileCount: number;
  restoredMappingCount: number;
  restoredAt: number;
}> {
  requireDesktop();
  return invoke('drive_engine_restore_latest_snapshot', { request });
}

/**
 * Load the production filesystem tree from local SQLite. This never scans
 * Telegram and therefore remains instant after restart. Pagination is kept
 * bounded per folder; deeper pages can be requested when a folder is opened.
 */
export async function driveEngineLoadSidebar(accountId: string): Promise<DriveEngineLocation[]> {
  activateDriveEngineAccount(accountId);
  const drives: DriveEngineDrive[] = [];
  for (let offset = 0, pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
    const page = await driveEngineListDrives({ accountId, limit: 200, offset });
    drives.push(...page.drives);
    if (!page.hasMore || page.drives.length === 0) break;
    offset += page.drives.length;
  }
  const locations: DriveEngineLocation[] = [];
  for (const drive of drives) {
    const storagePeer = Number(drive.storagePeerId);
    const storagePeerId = Number.isFinite(storagePeer) ? storagePeer : null;
    const root = registerDriveEngineLocation({
      driveId: drive.driveId,
      folderId: drive.rootFolderId,
      parentUiId: null,
      name: drive.name,
      storagePeerId,
      storageTopicId: drive.storageTopicId ?? null,
      root: true,
    });
    locations.push(root);
    const queue = [root];
    while (queue.length > 0) {
      const parent = queue.shift()!;
      for (let offset = 0, pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
        const children = await driveEngineListChildren({
          accountId,
          driveId: drive.driveId,
          parentId: parent.folderId,
          limit: 200,
          offset,
        });
        for (const child of children.folders) {
          const location = registerDriveEngineLocation({
            driveId: drive.driveId,
            folderId: child.folderId,
            parentUiId: parent.uiId,
            name: child.name,
            storagePeerId,
            storageTopicId: child.telegramTopicId ?? null,
            root: false,
          });
          locations.push(location);
          queue.push(location);
        }
        if (!children.hasMore || children.folders.length === 0) break;
        offset += children.folders.length;
      }
    }
  }
  return locations;
}

export async function driveEngineIntegrityReport(): Promise<DriveEngineIntegrity> {
  requireDesktop();
  return invoke<DriveEngineIntegrity>('drive_engine_integrity_report');
}
