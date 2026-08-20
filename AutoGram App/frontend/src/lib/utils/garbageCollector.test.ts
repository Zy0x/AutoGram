import { describe, expect, it, vi } from 'vitest';
import { garbageCollector } from './garbageCollector';

describe('GarbageCollector Subsystem Tests', () => {
  it('1. tracks and registers blob Object URLs', () => {
    const mockUrl = 'blob:http://localhost/test-uuid';
    const registered = garbageCollector.registerObjectUrl(mockUrl, 'thumb-1');
    expect(registered).toBe(mockUrl);
  });

  it('2. explicitly revokes and unregisters Object URLs', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const mockUrl = 'blob:http://localhost/test-uuid-2';

    garbageCollector.registerObjectUrl(mockUrl, 'thumb-2');
    garbageCollector.revokeObjectUrl(mockUrl);

    expect(revokeSpy).toHaveBeenCalledWith(mockUrl);
    revokeSpy.mockRestore();
  });

  it('3. runs garbage collection pass cleanly', async () => {
    const res = await garbageCollector.runGarbageCollection();
    expect(res).toBeDefined();
    expect(typeof res.revokedUrls).toBe('number');
    expect(typeof res.prunedCacheEntries).toBe('number');
  });

  it('4. forcePurgeAll clears all memory state without throwing', () => {
    expect(() => garbageCollector.forcePurgeAll()).not.toThrow();
  });
});
