import { describe, expect, it } from 'vitest';
import {
  DRIVE_TOPICS_CACHE_MAX_AGE_MS,
  loadDriveTopicsSnapshot,
  saveDriveTopicsSnapshot,
} from './driveTopicsCache';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('driveTopicsCache', () => {
  it('restores topics immediately for the same session and peer', () => {
    const storage = memoryStorage();
    saveDriveTopicsSnapshot(
      storage,
      'Lavender',
      -1001,
      [{ id: 7, title: 'Anime', top_message: 7, closed: false }],
      true,
      1_000
    );
    expect(loadDriveTopicsSnapshot(storage, 'Lavender', -1001, 2_000)).toMatchObject({
      is_forum: true,
      topics: [{ id: 7, title: 'Anime' }],
      savedAt: 1_000,
    });
  });

  it('rejects stale topic snapshots', () => {
    const storage = memoryStorage();
    saveDriveTopicsSnapshot(storage, 'Lavender', -1001, [], true, 1_000);
    expect(
      loadDriveTopicsSnapshot(
        storage,
        'Lavender',
        -1001,
        1_000 + DRIVE_TOPICS_CACHE_MAX_AGE_MS + 1
      )
    ).toBeNull();
  });
});
