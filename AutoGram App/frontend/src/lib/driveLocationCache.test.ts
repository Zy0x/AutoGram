import { describe, expect, it } from 'vitest';
import {
  DRIVE_LOCATION_CACHE_MAX_AGE_MS,
  driveLocationKey,
  loadDriveLocationSnapshot,
  saveDriveLocationSnapshot,
} from './driveLocationCache';
import type { DriveFile } from './driveTypes';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const file = (id: number): DriveFile => ({
  id,
  folder_id: -1001,
  name: `file-${id}.mp4`,
  size: id * 10,
  icon_type: 'video',
});

describe('driveLocationCache', () => {
  it('separates root, folder, and topic locations', () => {
    expect(driveLocationKey(null, null)).toBe('root:all');
    expect(driveLocationKey(-1001, null)).toBe('-1001:all');
    expect(driveLocationKey(-1001, 42)).toBe('-1001:42');
  });

  it('restores the first page with pagination metadata', () => {
    const storage = memoryStorage();
    saveDriveLocationSnapshot(
      storage,
      'Lavender',
      -1001,
      null,
      { files: [file(1), file(2)], hasMore: true, nextOffsetId: 77, totalCount: 100, totalBytes: 5000 },
      1000
    );
    expect(loadDriveLocationSnapshot(storage, 'Lavender', -1001, null, 1500)).toMatchObject({
      files: [file(1), file(2)],
      hasMore: true,
      nextOffsetId: 77,
      totalCount: 100,
      totalBytes: 5000,
    });
  });

  it('rejects stale entries', () => {
    const storage = memoryStorage();
    saveDriveLocationSnapshot(
      storage,
      'Lavender',
      null,
      null,
      { files: [file(1)], hasMore: false, nextOffsetId: null, totalCount: 1, totalBytes: 10 },
      1000
    );
    expect(
      loadDriveLocationSnapshot(storage, 'Lavender', null, null, 1000 + DRIVE_LOCATION_CACHE_MAX_AGE_MS + 1)
    ).toBeNull();
  });
});
