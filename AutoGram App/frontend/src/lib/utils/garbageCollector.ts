/**
 * garbageCollector.ts — Active Frontend Memory Hygiene & Garbage Collection (AutoGram Enterprise)
 *
 * Prevents memory leaks, bloat, and orphaned references by:
 * - Tracking and revoking stale Object URLs created for previews and thumbnails.
 * - Pruning expired L1 cache entries periodically.
 * - Triggering Rust-side memory compaction and WAL checkpointing over Tauri IPC.
 */

import { invoke } from '@tauri-apps/api/core';
import { detectTauriRuntime } from '../tauri/platform';
import { channelMetaCache, mediaListCache, searchCursorCache } from '../cache/multiTierCache';

interface TrackedObjectUrl {
  url: string;
  createdAt: number;
  label?: string;
}

class FrontendGarbageCollector {
  private objectUrls = new Map<string, TrackedObjectUrl>();
  private gcIntervalId: ReturnType<typeof setInterval> | null = null;
  private isRunningGc = false;

  constructor() {
    this.startPeriodicGc(45 * 1000); // Run every 45 seconds
  }

  /**
   * Registers an Object URL for automated lifetime tracking.
   */
  public registerObjectUrl(url: string, label?: string): string {
    if (url && url.startsWith('blob:')) {
      this.objectUrls.set(url, {
        url,
        createdAt: Date.now(),
        label,
      });
    }
    return url;
  }

  /**
   * Explicitly revokes an Object URL and unregisters it.
   */
  public revokeObjectUrl(url: string): void {
    if (url && this.objectUrls.has(url)) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      this.objectUrls.delete(url);
    }
  }

  /**
   * Starts periodic garbage collection cycle.
   */
  public startPeriodicGc(intervalMs: number = 45000): void {
    if (this.gcIntervalId) {
      clearInterval(this.gcIntervalId);
    }
    this.gcIntervalId = setInterval(() => {
      void this.runGarbageCollection();
    }, intervalMs);
  }

  /**
   * Stops periodic garbage collection cycle.
   */
  public stopPeriodicGc(): void {
    if (this.gcIntervalId) {
      clearInterval(this.gcIntervalId);
      this.gcIntervalId = null;
    }
  }

  /**
   * Runs an active garbage collection pass.
   */
  public async runGarbageCollection(): Promise<{
    revokedUrls: number;
    prunedCacheEntries: number;
    rustGcSuccess: boolean;
  }> {
    if (this.isRunningGc) {
      return { revokedUrls: 0, prunedCacheEntries: 0, rustGcSuccess: false };
    }
    this.isRunningGc = true;

    try {
      const now = Date.now();
      let revokedUrls = 0;

      // 1. Revoke Object URLs older than 10 minutes that haven't been actively refreshed
      const urlTtlMs = 10 * 60 * 1000;
      for (const [url, tracked] of this.objectUrls.entries()) {
        if (now - tracked.createdAt > urlTtlMs) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* ignore */
          }
          this.objectUrls.delete(url);
          revokedUrls++;
        }
      }

      // 2. Prune L1 In-Memory Caches
      let prunedCacheEntries = 0;
      prunedCacheEntries += mediaListCache.pruneExpired();
      prunedCacheEntries += searchCursorCache.pruneExpired();
      prunedCacheEntries += channelMetaCache.pruneExpired();

      // 3. Trigger Rust Core GC if on desktop
      let rustGcSuccess = false;
      if (detectTauriRuntime()) {
        try {
          const res = await invoke<{ ok: boolean; freedBytes: number }>('tg_run_garbage_collection');
          rustGcSuccess = res?.ok ?? true;
        } catch (e) {
          console.warn('[GC] Rust garbage collection invocation failed', e);
        }
      }

      return {
        revokedUrls,
        prunedCacheEntries,
        rustGcSuccess,
      };
    } finally {
      this.isRunningGc = false;
    }
  }

  /**
   * Forces complete purge of all tracked URLs and memory caches (e.g. on session logout).
   */
  public forcePurgeAll(): void {
    for (const url of this.objectUrls.keys()) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
    this.objectUrls.clear();
    mediaListCache.clear();
    searchCursorCache.clear();
    channelMetaCache.clear();
  }
}

export const garbageCollector = new FrontendGarbageCollector();
