import { describe, expect, it } from 'vitest';
import {
  driveScrollLocationKey,
  loadDriveScrollPosition,
  saveDriveScrollPosition,
} from './driveScrollMemory';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('Drive scroll memory', () => {
  it('keeps each location and view mode independent', () => {
    const storage = memoryStorage();
    const gridKey = driveScrollLocationKey('chat', 10, null, 'grid');
    const listKey = driveScrollLocationKey('chat', 10, null, 'list');
    saveDriveScrollPosition(storage, 'Lavender', gridKey, 640);
    expect(loadDriveScrollPosition(storage, 'Lavender', gridKey)).toBe(640);
    expect(loadDriveScrollPosition(storage, 'Lavender', listKey)).toBe(0);
  });

  it('returns the top for a location that has never been opened', () => {
    expect(loadDriveScrollPosition(memoryStorage(), 'Lavender', 'drive:1:all:grid')).toBe(0);
  });
});
