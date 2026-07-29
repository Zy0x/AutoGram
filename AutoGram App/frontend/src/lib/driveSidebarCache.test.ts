import { describe, expect, it } from 'vitest';
import {
  DRIVE_SIDEBAR_CACHE_MAX_AGE_MS,
  loadDriveSidebarSnapshot,
  saveDriveSidebarSnapshot,
} from './driveSidebarCache';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('driveSidebarCache', () => {
  it('merges progressive chat and folder updates', () => {
    const storage = memoryStorage();
    saveDriveSidebarSnapshot(storage, 'Lavender', {
      chats: [{ id: 1, name: 'Chat', type: 'group' }],
      chatsHasMore: true,
      chatsOffset: 1,
    }, 1000);
    saveDriveSidebarSnapshot(storage, 'Lavender', {
      folders: [{ id: -1001, name: 'Drive', is_drive_folder: true }],
    }, 1500);
    expect(loadDriveSidebarSnapshot(storage, 'Lavender', 2000)).toMatchObject({
      chats: [{ id: 1, name: 'Chat', type: 'group' }],
      folders: [{ id: -1001, name: 'Drive', is_drive_folder: true }],
      chatsHasMore: true,
      chatsOffset: 1,
    });
  });

  it('rejects stale snapshots', () => {
    const storage = memoryStorage();
    saveDriveSidebarSnapshot(storage, 'Lavender', { chats: [], folders: [] }, 1000);
    expect(
      loadDriveSidebarSnapshot(storage, 'Lavender', 1000 + DRIVE_SIDEBAR_CACHE_MAX_AGE_MS + 1)
    ).toBeNull();
  });
});
