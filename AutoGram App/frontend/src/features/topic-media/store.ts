import { contextToKey, isSameContext } from './keys';
import type { ThumbnailMode, TopicMediaContext, TopicMediaCursor, TopicMediaItem } from './types';

export interface TopicMediaViewState {
  context: TopicMediaContext;
  generationId: number;
  status: 'idle' | 'loading-cache' | 'syncing' | 'ready' | 'error';
  items: TopicMediaItem[];
  cursor: TopicMediaCursor | null;
  hasMore: boolean;
  error: string | null;
}

export class TopicMediaStoreManager {
  private activeContext: TopicMediaContext | null = null;
  private currentGenerationId = 0;
  private viewsByKey: Map<string, TopicMediaViewState> = new Map();
  private thumbnailMode: ThumbnailMode = 'balance';
  private listeners: Set<() => void> = new Set();

  public getActiveContext(): TopicMediaContext | null {
    return this.activeContext;
  }

  public getCurrentGenerationId(): number {
    return this.currentGenerationId;
  }

  public getThumbnailMode(): ThumbnailMode {
    return this.thumbnailMode;
  }

  public setThumbnailMode(mode: ThumbnailMode): void {
    this.thumbnailMode = mode;
    this.notify();
  }

  public openTopic(context: TopicMediaContext): number {
    this.currentGenerationId += 1;
    this.activeContext = context;
    const key = contextToKey(context);

    // Fail-Closed: Ensure fresh or clean state for the new topic
    if (!this.viewsByKey.has(key)) {
      this.viewsByKey.set(key, {
        context,
        generationId: this.currentGenerationId,
        status: 'loading-cache',
        items: [],
        cursor: null,
        hasMore: true,
        error: null,
      });
    } else {
      const existing = this.viewsByKey.get(key)!;
      existing.generationId = this.currentGenerationId;
      existing.status = 'loading-cache';
    }

    this.notify();
    return this.currentGenerationId;
  }

  public setInitialItems(
    context: TopicMediaContext,
    generationId: number,
    items: TopicMediaItem[],
    cursor: TopicMediaCursor | null,
    hasMore: boolean,
  ): void {
    if (generationId !== this.currentGenerationId || !isSameContext(context, this.activeContext)) {
      return; // Stale or context mismatch: Reject
    }

    const key = contextToKey(context);
    this.viewsByKey.set(key, {
      context,
      generationId,
      status: 'syncing',
      items,
      cursor,
      hasMore,
      error: null,
    });
    this.notify();
  }

  public applyDelta(
    context: TopicMediaContext,
    generationId: number,
    inserted: TopicMediaItem[],
    updated: TopicMediaItem[],
    deletedMessageIds: number[],
    cursor: TopicMediaCursor | null,
    hasMore: boolean,
  ): void {
    if (generationId !== this.currentGenerationId || !isSameContext(context, this.activeContext)) {
      return; // Stale or context mismatch: Reject
    }

    const key = contextToKey(context);
    const view = this.viewsByKey.get(key);
    if (!view) return;

    let items = [...view.items];

    // Handle deletions
    if (deletedMessageIds.length > 0) {
      const delSet = new Set(deletedMessageIds);
      items = items.filter((it) => !delSet.has(it.messageId));
    }

    // Handle updates
    if (updated.length > 0) {
      const updateMap = new Map(updated.map((u) => [u.messageId, u]));
      items = items.map((it) => updateMap.get(it.messageId) || it);
    }

    // Handle insertions (prepend or merge by messageId)
    if (inserted.length > 0) {
      const existingIds = new Set(items.map((i) => i.messageId));
      const freshInserted = inserted.filter((i) => !existingIds.has(i.messageId));
      items = [...freshInserted, ...items];
    }

    items.sort((a, b) => b.messageDate - a.messageDate || b.messageId - a.messageId);

    view.items = items;
    view.cursor = cursor || view.cursor;
    view.hasMore = hasMore;
    view.status = 'ready';

    this.notify();
  }

  public getActiveViewState(): TopicMediaViewState | null {
    if (!this.activeContext) return null;
    const key = contextToKey(this.activeContext);
    return this.viewsByKey.get(key) || null;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }
}

export const topicMediaStore = new TopicMediaStoreManager();
