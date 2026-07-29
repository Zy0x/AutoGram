import { getPersistentThumbsSize, prunePersistentThumbsToSize } from '../thumbPersistentCache';
import { clearThumbCache } from '../thumbBatcher';
import { clearAvatarCache } from '../avatarBatcher';
import { clearPreviewCache } from '../previewCache';
import { cacheCalculateSize, cacheTrimDisk } from '../jobsApi';

let isPruning = false;

export async function checkAndAutoPruneCache(): Promise<{ pruned: boolean; freedBytes: number }> {
  if (isPruning) {
    return { pruned: false, freedBytes: 0 };
  }

  const enabledStr = localStorage.getItem('autogram_auto_prune_enabled');
  const autoPruneEnabled = enabledStr === null ? true : enabledStr === 'true';

  if (!autoPruneEnabled) {
    return { pruned: false, freedBytes: 0 };
  }

  const savedLimit = localStorage.getItem('autogram_cache_limit_mb');
  const limitMB = savedLimit !== null ? Number(savedLimit) : 5120; // Default 5 GB

  if (isNaN(limitMB) || limitMB <= 0) {
    return { pruned: false, freedBytes: 0 }; // 0 means unlimited
  }

  const limitBytes = limitMB * 1024 * 1024;

  isPruning = true;
  try {
    // 1. Calculate IDB Persistent Thumbs
    let idbSize = 0;
    try {
      idbSize = await getPersistentThumbsSize();
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

    if (totalCacheSize > limitBytes) {
      console.log(`[AutoCachePruner] Cache size (${(totalCacheSize / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds limit (${limitMB} MB). Starting auto-prune...`);

      // 1. Prune IndexedDB Thumbs to limit
      await prunePersistentThumbsToSize(limitBytes);

      // 2. Clear in-memory UI thumbnail/avatar caches
      clearThumbCache();
      clearAvatarCache();
      clearPreviewCache();

      // 3. Trim Rust Disk Cache to limit (respecting active file lock & 10 min window)
      try {
        await cacheTrimDisk(limitBytes);
      } catch (err) {
        console.warn('[AutoCachePruner] Failed to trim disk cache:', err);
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
