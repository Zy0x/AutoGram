import { describe, it, expect, beforeEach } from 'vitest';
import {
  folderAllDescendantIds,
  folderDirectChildIds,
} from './chatSearch';
import {
  loadDriveRecents,
  pushDriveRecent,
  removeDriveRecent,
  loadDrivePins,
  toggleDrivePin,
  removeDrivePin,
  removeMultipleDriveLocations,
} from '../cache/driveRecents';
import {
  loadDriveLocationSnapshot,
  saveDriveLocationSnapshot,
  clearDriveLocationForPeer,
  clearMultipleDriveLocations,
} from '../cache/driveLocationCache';
import {
  loadDriveSidebarSnapshot,
  saveDriveSidebarSnapshot,
  removeFoldersFromDriveSidebarSnapshot,
} from '../cache/driveSidebarCache';
import type { DriveFolder } from '../driveTypes';

function createMockStorage(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  clear: () => void;
} {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
}

describe('folderAllDescendantIds - Recursive Hierarchy Traversal', () => {
  const mockFolders: DriveFolder[] = [
    { id: 100, name: 'Root Drive', title_raw: '[TD] Root Drive', parent_id: null, is_drive_folder: true },
    { id: 101, name: 'Folder A', title_raw: '[TD] Folder A', parent_id: 100, is_drive_folder: true },
    { id: 102, name: 'Folder B', title_raw: '[TD] Folder B', parent_id: 100, is_drive_folder: true },
    { id: 103, name: 'Subfolder A1', title_raw: '[TD] Subfolder A1', parent_id: 101, is_drive_folder: true },
    { id: 104, name: 'Subfolder A2', title_raw: '[TD] Subfolder A2', parent_id: 101, is_drive_folder: true },
    { id: 105, name: 'Deep Subfolder A1-Alpha', title_raw: '[TD] Deep', parent_id: 103, is_drive_folder: true },
    { id: 200, name: 'Unrelated Root Drive 2', title_raw: '[TD] Root 2', parent_id: null, is_drive_folder: true },
  ];

  it('returns empty array when folder has no children', () => {
    const descendants = folderAllDescendantIds(mockFolders, 105);
    expect(descendants).toEqual([]);
  });

  it('returns direct children for a 1-level parent', () => {
    const descendants = folderAllDescendantIds(mockFolders, 103);
    expect(descendants).toEqual([105]);
  });

  it('returns full recursive tree for deep parent', () => {
    const descendants = folderAllDescendantIds(mockFolders, 101);
    expect(descendants.sort()).toEqual([103, 104, 105].sort());
  });

  it('returns all descendants under root drive', () => {
    const descendants = folderAllDescendantIds(mockFolders, 100);
    expect(descendants.sort()).toEqual([101, 102, 103, 104, 105].sort());
    expect(descendants).not.toContain(200);
  });

  it('is cycle-safe when circular parent_id exists', () => {
    const cyclicFolders: DriveFolder[] = [
      { id: 1, name: 'Node 1', title_raw: '1', parent_id: 2, is_drive_folder: true },
      { id: 2, name: 'Node 2', title_raw: '2', parent_id: 1, is_drive_folder: true },
    ];
    const descendants = folderAllDescendantIds(cyclicFolders, 1);
    expect(descendants).toEqual([2]);
  });
});

describe('driveRecents - Purge Removed Locations', () => {
  let mockStore: ReturnType<typeof createMockStorage>;
  const session = 'test_session_user_1';

  beforeEach(() => {
    mockStore = createMockStorage();
  });

  it('removes single drive from recents', () => {
    pushDriveRecent(session, { kind: 'drive', id: 100, label: 'Drive 100' }, mockStore);
    pushDriveRecent(session, { kind: 'drive', id: 101, label: 'Drive 101' }, mockStore);
    pushDriveRecent(session, { kind: 'saved', id: null, label: 'Saved Messages' }, mockStore);

    expect(loadDriveRecents(session, mockStore)).toHaveLength(3);

    const updated = removeDriveRecent(session, 'drive', 101, mockStore);
    expect(updated).toHaveLength(2);
    expect(updated.some((r) => r.id === 101)).toBe(false);
    expect(loadDriveRecents(session, mockStore).some((r) => r.id === 101)).toBe(false);
  });

  it('removes single drive from pins', () => {
    toggleDrivePin(session, { kind: 'drive', id: 100, label: 'Drive 100' }, mockStore);
    toggleDrivePin(session, { kind: 'drive', id: 101, label: 'Drive 101' }, mockStore);

    expect(loadDrivePins(session, mockStore)).toHaveLength(2);

    const updated = removeDrivePin(session, 'drive', 100, mockStore);
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe(101);
  });

  it('removes multiple drive locations simultaneously from both recents and pins', () => {
    pushDriveRecent(session, { kind: 'drive', id: 100, label: 'Drive 100' }, mockStore);
    pushDriveRecent(session, { kind: 'drive', id: 101, label: 'Drive 101' }, mockStore);
    pushDriveRecent(session, { kind: 'drive', id: 102, label: 'Drive 102' }, mockStore);
    pushDriveRecent(session, { kind: 'chat', id: 555, label: 'Telegram Group' }, mockStore);

    toggleDrivePin(session, { kind: 'drive', id: 100, label: 'Drive 100' }, mockStore);
    toggleDrivePin(session, { kind: 'drive', id: 101, label: 'Drive 101' }, mockStore);

    const { recents, pins } = removeMultipleDriveLocations(session, [100, 101], 'drive', mockStore);
    expect(recents).toHaveLength(2);
    expect(recents.map((r) => r.id)).toEqual([555, 102]);

    expect(pins).toHaveLength(0);
  });
});

describe('driveLocationCache - Clear Snapshots for Deleted Peers', () => {
  let mockStore: ReturnType<typeof createMockStorage>;
  const session = 'test_session_user_2';

  beforeEach(() => {
    mockStore = createMockStorage();
  });

  it('clears all cached location snapshots for a deleted peer', () => {
    saveDriveLocationSnapshot(mockStore, session, 100, null, {
      files: [{ id: 1, name: 'File1.mp4', size: 1024 } as any],
      hasMore: false,
      nextOffsetId: null,
      totalCount: 1,
      totalBytes: 1024,
    });
    saveDriveLocationSnapshot(mockStore, session, 100, 5, {
      files: [{ id: 2, name: 'TopicFile.mp4', size: 2048 } as any],
      hasMore: false,
      nextOffsetId: null,
      totalCount: 1,
      totalBytes: 2048,
    });
    saveDriveLocationSnapshot(mockStore, session, 200, null, {
      files: [{ id: 3, name: 'Other.mp4', size: 512 } as any],
      hasMore: false,
      nextOffsetId: null,
      totalCount: 1,
      totalBytes: 512,
    });

    expect(loadDriveLocationSnapshot(mockStore, session, 100, null)).not.toBeNull();
    expect(loadDriveLocationSnapshot(mockStore, session, 100, 5)).not.toBeNull();
    expect(loadDriveLocationSnapshot(mockStore, session, 200, null)).not.toBeNull();

    clearDriveLocationForPeer(mockStore, session, 100);

    expect(loadDriveLocationSnapshot(mockStore, session, 100, null)).toBeNull();
    expect(loadDriveLocationSnapshot(mockStore, session, 100, 5)).toBeNull();
    expect(loadDriveLocationSnapshot(mockStore, session, 200, null)).not.toBeNull();
  });

  it('clears multiple drive location snapshots at once', () => {
    saveDriveLocationSnapshot(mockStore, session, 101, null, {
      files: [{ id: 1, name: 'File1.mp4', size: 1024 } as any],
      hasMore: false,
      nextOffsetId: null,
      totalCount: 1,
      totalBytes: 1024,
    });
    saveDriveLocationSnapshot(mockStore, session, 102, null, {
      files: [{ id: 2, name: 'File2.mp4', size: 1024 } as any],
      hasMore: false,
      nextOffsetId: null,
      totalCount: 1,
      totalBytes: 1024,
    });
    saveDriveLocationSnapshot(mockStore, session, 200, null, {
      files: [{ id: 3, name: 'Keep.mp4', size: 1024 } as any],
      hasMore: false,
      nextOffsetId: null,
      totalCount: 1,
      totalBytes: 1024,
    });

    clearMultipleDriveLocations(mockStore, session, [101, 102]);

    expect(loadDriveLocationSnapshot(mockStore, session, 101, null)).toBeNull();
    expect(loadDriveLocationSnapshot(mockStore, session, 102, null)).toBeNull();
    expect(loadDriveLocationSnapshot(mockStore, session, 200, null)).not.toBeNull();
  });
});

describe('driveSidebarCache - Remove Folders Snapshot', () => {
  let mockStore: ReturnType<typeof createMockStorage>;
  const session = 'test_session_user_3';

  beforeEach(() => {
    mockStore = createMockStorage();
  });

  it('removes deleted folders from sidebar snapshot', () => {
    saveDriveSidebarSnapshot(mockStore, session, {
      folders: [
        { id: 10, name: 'Drive A', title_raw: '[TD] Drive A', parent_id: null, is_drive_folder: true },
        { id: 11, name: 'Folder A1', title_raw: '[TD] Folder A1', parent_id: 10, is_drive_folder: true },
        { id: 20, name: 'Drive B', title_raw: '[TD] Drive B', parent_id: null, is_drive_folder: true },
      ],
      chats: [
        { id: 10, name: 'Drive A', title_raw: '[TD] Drive A', type: 'channel', is_drive_folder: true },
        { id: 30, name: 'General Chat', title_raw: 'General Chat', type: 'group', is_drive_folder: false },
      ],
    });

    removeFoldersFromDriveSidebarSnapshot(mockStore, session, [10, 11]);

    const snapshot = loadDriveSidebarSnapshot(mockStore, session);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.folders).toHaveLength(1);
    expect(snapshot?.folders[0].id).toBe(20);
    expect(snapshot?.chats).toHaveLength(1);
    expect(snapshot?.chats[0].id).toBe(30);
  });
});
