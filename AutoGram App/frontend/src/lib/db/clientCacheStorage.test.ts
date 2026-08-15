import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearClientCacheStorage, getClientCacheStorageSize } from './clientCacheStorage';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe('client cache clear boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
  });

  it('clears rebuildable navigation caches and keeps session, pins, settings, and queues', () => {
    localStorage.setItem('autogram_drive_locations_v1_Mantan', '{"files":[1]}');
    localStorage.setItem('autogram_drive_peer_v2_Mantan', '-1001');
    sessionStorage.setItem('drive_root_files_Mantan', '{"files":[1]}');

    localStorage.setItem('autogram_drive_session', 'Mantan');
    localStorage.setItem('autogram_default_session', 'Lavender');
    localStorage.setItem('autogram_drive_pins_v2_Mantan', '["-1001"]');
    localStorage.setItem('autogram_cache_limit_mb', '5120');
    localStorage.setItem('autogram_drive_upload_queue', '[{"id":1}]');

    expect(getClientCacheStorageSize()).toBeGreaterThan(0);
    const result = clearClientCacheStorage();

    expect(result.removedEntries).toBe(3);
    expect(getClientCacheStorageSize()).toBe(0);
    expect(localStorage.getItem('autogram_drive_session')).toBe('Mantan');
    expect(localStorage.getItem('autogram_default_session')).toBe('Lavender');
    expect(localStorage.getItem('autogram_drive_pins_v2_Mantan')).toBe('["-1001"]');
    expect(localStorage.getItem('autogram_cache_limit_mb')).toBe('5120');
    expect(localStorage.getItem('autogram_drive_upload_queue')).toBe('[{"id":1}]');
  });
});
