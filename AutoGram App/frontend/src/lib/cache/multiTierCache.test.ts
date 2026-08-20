import { describe, expect, it } from 'vitest';
import { MultiTierCache } from './multiTierCache';

describe('MultiTierCache Subsystem Tests', () => {
  it('1. correctly sets and gets values from L1 cache', () => {
    const cache = new MultiTierCache<string>({ maxMemoryEntries: 10, defaultTtlMs: 10000 });
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
    expect(cache.has('key1')).toBe(true);
  });

  it('2. returns undefined for nonexistent keys', () => {
    const cache = new MultiTierCache<number>({ maxMemoryEntries: 10 });
    expect(cache.get('nonexistent')).toBeUndefined();
    expect(cache.has('nonexistent')).toBe(false);
  });

  it('3. evicts least recently used items when capacity is exceeded', () => {
    const cache = new MultiTierCache<string>({ maxMemoryEntries: 3 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    // Access 'a' so 'b' becomes the oldest
    cache.get('a');

    // Add 'd', which should evict 'b'
    cache.set('d', '4');

    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('3');
    expect(cache.get('d')).toBe('4');
  });

  it('4. respects TTL expiration', async () => {
    const cache = new MultiTierCache<string>({ maxMemoryEntries: 10, defaultTtlMs: 50 });
    cache.set('temp', 'val', 50);
    expect(cache.get('temp')).toBe('val');

    await new Promise((r) => setTimeout(r, 60));
    expect(cache.get('temp')).toBeUndefined();
  });

  it('5. pruneExpired correctly removes stale items', async () => {
    const cache = new MultiTierCache<string>({ maxMemoryEntries: 10 });
    cache.set('fresh', 'fresh_val', 10000);
    cache.set('stale', 'stale_val', 20);

    await new Promise((r) => setTimeout(r, 30));
    const pruned = cache.pruneExpired();
    expect(pruned).toBe(1);
    expect(cache.get('fresh')).toBe('fresh_val');
    expect(cache.get('stale')).toBeUndefined();
  });

  it('6. correctly deletes keys and clears all entries', () => {
    const cache = new MultiTierCache<number>({ maxMemoryEntries: 10 });
    cache.set('x', 10);
    cache.set('y', 20);

    expect(cache.delete('x')).toBe(true);
    expect(cache.get('x')).toBeUndefined();
    expect(cache.get('y')).toBe(20);

    cache.clear();
    expect(cache.get('y')).toBeUndefined();
    expect(cache.getStats().entries).toBe(0);
  });
});
