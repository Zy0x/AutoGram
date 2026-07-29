import { describe, expect, it } from 'vitest';
import {
  clearPersistentThumbs,
  loadPersistentThumb,
  loadPersistentThumbs,
  savePersistentThumb,
} from './thumbPersistentCache';

describe('thumbPersistentCache without browser IndexedDB', () => {
  it('fails open without blocking thumbnail rendering', async () => {
    await expect(loadPersistentThumb('balanced:home:1')).resolves.toBeNull();
    await expect(savePersistentThumb('balanced:home:1', 'data:image/jpeg;base64,AA==')).resolves.toBeUndefined();
  });

  it('bulk reads and clears fail open without IndexedDB', async () => {
    await expect(loadPersistentThumbs(['a', 'b'])).resolves.toEqual(new Map());
    await expect(clearPersistentThumbs()).resolves.toBeUndefined();
  });
});
