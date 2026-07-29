import { beforeEach, describe, expect, it, vi } from 'vitest';

const { batch } = vi.hoisted(() => ({
  batch: vi.fn(async (_creds, ids: number[]) => ({
    status: 'success',
    thumbs: Object.fromEntries(ids.map((id) => [String(id), `data:${id}`])),
  })),
}));

vi.mock('./driveApi', () => ({ driveThumbnailsBatch: batch }));
vi.mock('./driveSession', () => ({ isDriveSessionReady: () => true }));
vi.mock('./devicePerformance', () => ({
  getDrivePerfProfile: () => ({
    tier: 'high', thumbBatch: 12, thumbFlushMs: 5, thumbQueueMax: 12,
    thumbConcurrent: 2, thumbSoftFailMs: 1000,
  }),
}));
vi.mock('./thumbPersistentCache', () => ({
  loadPersistentThumb: async () => null,
  loadPersistentThumbs: async () => new Map(),
  savePersistentThumb: async () => undefined,
}));

import {
  clearThumbCache,
  requestThumb,
  setThumbBootstrapMode,
  setThumbContext,
  setThumbsPaused,
} from './thumbBatcher';

const creds = { session: 'Lavender', apiId: '1', apiHash: 'hidden' };

describe('location-scoped thumbnail scheduler', () => {
  beforeEach(() => {
    batch.mockClear();
    clearThumbCache();
    setThumbBootstrapMode(true);
    setThumbsPaused(false);
  });

  it('cancels queued work when location ownership changes', async () => {
    setThumbsPaused(true);
    setThumbContext(creds, 100, null);
    const pending = requestThumb(creds, 100, 1, { priority: 'prefetch' });
    await Promise.resolve();
    setThumbContext(creds, 200, null);
    await expect(pending).resolves.toBeNull();
    expect(batch).not.toHaveBeenCalled();
  });

  it('deduplicates simultaneous visible requests for the same message', async () => {
    setThumbContext(creds, 300, null);
    const first = requestThumb(creds, 300, 9, { priority: 'visible' });
    const second = requestThumb(creds, 300, 9, { priority: 'visible' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await expect(Promise.all([first, second])).resolves.toEqual(['data:9', 'data:9']);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][1]).toEqual([9]);
  });
});
