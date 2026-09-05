import { describe, expect, it } from 'vitest';
import {
  PLAYBACK_HISTORY_TTL_MS,
  clearPlaybackHistory,
  loadPlaybackPosition,
  playbackHistoryStorageKey,
  savePlaybackPosition,
} from './playbackHistory';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  } as Storage;
}

describe('playbackHistory', () => {
  it('expires records after ninety days', () => {
    const storage = memoryStorage();
    const now = 1_000_000;
    savePlaybackPosition(storage, 'alice', 'saved:11:99', 42, 120, now);
    expect(loadPlaybackPosition(storage, 'alice', 'saved:11:99', now + PLAYBACK_HISTORY_TTL_MS - 1)).toMatchObject({ positionSeconds: 42 });
    expect(loadPlaybackPosition(storage, 'alice', 'saved:11:99', now + PLAYBACK_HISTORY_TTL_MS + 1)).toBeNull();
  });

  it('clears one session without touching another', () => {
    const storage = memoryStorage();
    savePlaybackPosition(storage, 'alice', 'saved:1:1', 10, 100);
    savePlaybackPosition(storage, 'bob', 'saved:1:1', 20, 100);
    clearPlaybackHistory(storage, 'alice');
    expect(storage.getItem(playbackHistoryStorageKey('alice'))).toBeNull();
    expect(loadPlaybackPosition(storage, 'bob', 'saved:1:1')).toMatchObject({ positionSeconds: 20 });
  });
});
