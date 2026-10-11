import { useLayoutEffect, useRef, useCallback } from 'react';
import type { DriveFile, DriveViewMode } from '../../../lib/telegram/driveTypes';
import {
  calculateVisibleStartIndex,
  accumulateNewMediaCount,
} from './NewMediaFloatingPill';

export type ContentNotice = {
  kind: 'added' | 'updated' | 'removed' | 'reordered';
  count: number;
  targetId: number | null;
};

export interface UseScrollAnchorRetentionOptions {
  displayed: DriveFile[];
  parentRef: React.RefObject<HTMLDivElement | null>;
  viewMode: DriveViewMode;
  cols: number;
  rowHeight: number;
  listRowHeight?: number;
  activeScrollKey: string;
  totalNewItemsRef: React.MutableRefObject<number>;
  lastStableScrollTopRef: React.MutableRefObject<number>;
  setContentNotice: React.Dispatch<React.SetStateAction<ContentNotice | null>>;
  onVirtualizerScroll?: (targetTop: number) => void;
}

/**
 * Pure calculation function for exact scroll anchor retention.
 */
export function calculateScrollAnchorAdjustment({
  scrollTop,
  previous,
  displayed,
  viewMode,
  cols,
  rowHeight,
  listRowHeight = 48,
}: {
  scrollTop: number;
  previous: DriveFile[];
  displayed: DriveFile[];
  viewMode: DriveViewMode;
  cols: number;
  rowHeight: number;
  listRowHeight?: number;
}): { targetScrollTop: number; shiftPx: number; newAbove: number } {
  const prevCount = previous.length;
  const currentCount = displayed.length;
  const prevFirstId = previous[0]?.id ?? null;
  const currentFirstId = displayed[0]?.id ?? null;

  if (scrollTop <= 80 || prevCount === 0 || currentCount <= prevCount || prevFirstId === currentFirstId) {
    return { targetScrollTop: scrollTop, shiftPx: 0, newAbove: 0 };
  }

  const rowH = viewMode === 'list' ? listRowHeight : (rowHeight || 180);
  const safeCols = Math.max(1, cols || 1);

  // Identify anchor item
  const prevAnchorIndex = calculateVisibleStartIndex(
    scrollTop,
    viewMode,
    rowHeight || 180,
    cols || 1,
    listRowHeight
  );
  const anchorItem = previous[prevAnchorIndex];

  const prevRow =
    viewMode === 'list'
      ? prevAnchorIndex
      : Math.floor(prevAnchorIndex / safeCols);
  const anchorOffset = scrollTop - prevRow * rowH;

  let targetScrollTop = scrollTop;
  const newAnchorIndex = anchorItem
    ? displayed.findIndex((f) => f.id === anchorItem.id)
    : -1;

  if (newAnchorIndex >= 0) {
    const newRow =
      viewMode === 'list'
        ? newAnchorIndex
        : Math.floor(newAnchorIndex / safeCols);
    targetScrollTop = newRow * rowH + anchorOffset;
  } else {
    const prevFirstIndexInNew = displayed.findIndex((f) => f.id === prevFirstId);
    if (prevFirstIndexInNew > 0) {
      const shiftRows =
        viewMode === 'list'
          ? prevFirstIndexInNew
          : Math.floor(prevFirstIndexInNew / safeCols);
      targetScrollTop = scrollTop + shiftRows * rowH;
    }
  }

  const prevFirstIndexInNew = displayed.findIndex((f) => f.id === prevFirstId);
  const newAbove =
    prevFirstIndexInNew >= 0 ? prevFirstIndexInNew : currentCount - prevCount;

  return {
    targetScrollTop,
    shiftPx: targetScrollTop - scrollTop,
    newAbove: Math.max(0, newAbove),
  };
}

/**
 * Twitter-like scroll anchor retention engine.
 * When new items arrive above the viewport while the user is scrolled down (scrollTop > 80),
 * this hook freezes the user's visible items in place with exact sub-pixel precision before paint
 * and emits a notice for the floating pill banner without unexpected viewport shifts.
 */
export function useScrollAnchorRetention({
  displayed,
  parentRef,
  viewMode,
  cols,
  rowHeight,
  listRowHeight = 48,
  activeScrollKey,
  totalNewItemsRef,
  lastStableScrollTopRef,
  setContentNotice,
  onVirtualizerScroll,
}: UseScrollAnchorRetentionOptions) {
  const snapshotOf = useCallback(
    (items: DriveFile[]) =>
      new Map(
        items.map((item) => [
          item.id,
          `${String(item.name || '')}|${Number(item.size || 0)}|${String(item.mime_type || '')}|${String(item.created_at || '')}`,
        ])
      ),
    []
  );

  const prevDisplayedRef = useRef<DriveFile[]>(displayed);
  const prevSnapshotRef = useRef<Map<number, string>>(snapshotOf(displayed));
  const prevLocationKeyRef = useRef<string>(activeScrollKey);

  useLayoutEffect(() => {
    // 1. Reset state on location / topic / folder switch
    if (prevLocationKeyRef.current !== activeScrollKey) {
      prevLocationKeyRef.current = activeScrollKey;
      setContentNotice(null);
      totalNewItemsRef.current = 0;
      prevDisplayedRef.current = displayed;
      prevSnapshotRef.current = snapshotOf(displayed);
      return;
    }

    const previous = prevDisplayedRef.current;
    const previousSnapshot = prevSnapshotRef.current;
    const prevCount = previous.length;
    const currentCount = displayed.length;
    const prevFirstId = previous[0]?.id ?? null;
    const currentFirstId = displayed[0]?.id ?? null;

    prevDisplayedRef.current = displayed;
    const currentSnapshot = snapshotOf(displayed);
    prevSnapshotRef.current = currentSnapshot;

    if (prevCount === 0) return;

    const el = parentRef.current;
    const scrollTop = el ? el.scrollTop : 0;

    // When near the top, new items naturally prepend without needing anchor retention or pill
    if (scrollTop <= 80) {
      setContentNotice(null);
      totalNewItemsRef.current = 0;
      return;
    }

    // Check if new items were prepended or inserted
    if (currentCount > prevCount && prevFirstId !== currentFirstId) {
      const adjustment = calculateScrollAnchorAdjustment({
        scrollTop,
        previous,
        displayed,
        viewMode,
        cols,
        rowHeight,
        listRowHeight,
      });

      // Exact pixel adjustment to freeze visible content in place before browser paint
      if (Math.abs(adjustment.shiftPx) > 0.5 && el) {
        el.scrollTop = adjustment.targetScrollTop;
        lastStableScrollTopRef.current = adjustment.targetScrollTop;
        onVirtualizerScroll?.(adjustment.targetScrollTop);
      }

      if (adjustment.newAbove > 0) {
        const accumulatedTotal = accumulateNewMediaCount(
          totalNewItemsRef.current,
          adjustment.newAbove
        );
        totalNewItemsRef.current = accumulatedTotal;
        setContentNotice({
          kind: 'added',
          count: accumulatedTotal,
          targetId: currentFirstId,
        });
        return;
      }
    }

    // 3. Removed items detection
    const removed = previous.filter((item) => !currentSnapshot.has(item.id));
    if (removed.length > 0) {
      const nearestId =
        displayed.find((item) => item.id < removed[0].id)?.id ??
        displayed[0]?.id ??
        null;
      setContentNotice({ kind: 'removed', count: removed.length, targetId: nearestId });
      return;
    }

    // 4. Updated items signature detection
    const updated = displayed.filter((item) => {
      const oldSignature = previousSnapshot.get(item.id);
      return oldSignature != null && oldSignature !== currentSnapshot.get(item.id);
    });
    if (updated.length > 0) {
      setContentNotice({ kind: 'updated', count: updated.length, targetId: updated[0].id });
      return;
    }

    // 5. Reordered items detection
    if (prevFirstId !== currentFirstId && currentCount === prevCount) {
      setContentNotice({
        kind: 'reordered',
        count: currentCount,
        targetId: currentFirstId,
      });
    }
  }, [
    activeScrollKey,
    displayed,
    viewMode,
    cols,
    rowHeight,
    listRowHeight,
    snapshotOf,
    parentRef,
    totalNewItemsRef,
    lastStableScrollTopRef,
    setContentNotice,
    onVirtualizerScroll,
  ]);
}
