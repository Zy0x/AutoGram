import { getPersistentThumbsSize, prunePersistentThumbsToSize } from '../media/thumbPersistentCache';
import { clearMediaStudioCache, getMediaStudioCacheSize } from '../db/mediaStudioDb';
import { clearThumbCache } from '../media/thumbBatcher';
import { clearAvatarCache } from '../media/avatarBatcher';
import { clearPreviewCache } from '../media/previewCache';
import { cacheCalculateSize, cacheSetPolicy, cacheTrimDisk } from '../db/jobsApi';

let isPruning = false;

export async function checkAndAutoPruneCache(): Promise<{ pruned: boolean; freedBytes: number }> {
  if (isPruning) {
    return { pruned: false, freedBytes: 0 };
  }

  const enabledStr = localStorage.getItem('autogram_auto_prune_enabled');
  const autoPruneEnabled = enabledStr === null ? true : enabledStr === 'true';

  const savedLimit = localStorage.getItem('autogram_cache_limit_mb');
  const limitMB = savedLimit !== null ? Number(savedLimit) : 5120; // Default 5 GB

  if (isNaN(limitMB) || limitMB <= 0) {
    return { pruned: false, freedBytes: 0 }; // 0 means unlimited
  }

  const limitBytes = limitMB * 1024 * 1024;

  isPruning = true;
  try {
    // 1. Calculate IDB Persistent Thumbs & Media Studio
    let idbSize = 0;
    try {
      idbSize = (await getPersistentThumbsSize()) + (await getMediaStudioCacheSize());
    } catch {
      /* best effort */
    }

    // 2. Calculate Disk Cache Backend (Rust)
    let diskSize = 0;
    try {
      const out = await cacheCalculateSize();
      diskSize = Number(out?.bytes || 0);
    } catch {
      /* best effort */
    }

    const totalCacheSize = idbSize + diskSize;

    await cacheSetPolicy(limitBytes, autoPruneEnabled);

    if (totalCacheSize > limitBytes) {
      console.log(`[AutoCachePruner] Cache size (${(totalCacheSize / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds limit (${limitMB} MB). Starting auto-prune...`);

      // Budget the cache as one pool. Giving both IndexedDB and disk the full
      // limit independently is what previously allowed the total to exceed it.
      const studioSize = await getMediaStudioCacheSize().catch(() => 0);
      await prunePersistentThumbsToSize(Math.max(0, limitBytes - studioSize - diskSize));

      // 2. Clear in-memory UI thumbnail/avatar caches
      clearThumbCache();
      clearAvatarCache();
      clearPreviewCache();

      const thumbSize = await getPersistentThumbsSize().catch(() => 0);
      // 3. Give Rust only the remaining combined budget.
      try {
        await cacheTrimDisk(Math.max(0, limitBytes - studioSize - thumbSize));
      } catch (err) {
        console.warn('[AutoCachePruner] Failed to trim disk cache:', err);
      }

      // Media-list records are rebuildable. If all older disk/thumb entries were
      // exhausted and the pool is still over budget, release that final cache.
      const afterDisk = await cacheCalculateSize().catch(() => null);
      const afterThumbs = await getPersistentThumbsSize().catch(() => 0);
      if ((Number(afterDisk?.bytes || 0) + afterThumbs + studioSize) > limitBytes) {
        await clearMediaStudioCache();
        await cacheTrimDisk(Math.max(0, limitBytes - afterThumbs));
      }

      // Calculate new size after pruning
      let newDiskSize = 0;
      try {
        const outNew = await cacheCalculateSize();
        newDiskSize = Number(outNew?.bytes || 0);
      } catch {
        /* best effort */
      }
      const newTotal = (await getPersistentThumbsSize()) + newDiskSize;
      const freed = Math.max(0, totalCacheSize - newTotal);

      console.log(`[AutoCachePruner] Auto-prune completed. Freed ${(freed / (1024 * 1024)).toFixed(2)} MB.`);
      return { pruned: true, freedBytes: freed };
    }
  } catch (err) {
    console.error('[AutoCachePruner] Error during auto prune:', err);
  } finally {
    isPruning = false;
  }

  return { pruned: false, freedBytes: 0 };
}
