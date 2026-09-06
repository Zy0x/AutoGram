import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getActiveDriveDrag,
  getDriveDragData,
  getLastHoverDropKey,
  isPointerDriveDragActive,
  setLastHoverDropKey,
  subscribeDriveDragUi,
} from '../../../lib/telegram';

export interface UseTopicDropOpts {
  onDropOnTopic?: (topicId: number | null, topicTitle: string, e: React.DragEvent) => void;
  topicPillsRef?: React.RefObject<HTMLDivElement | null>;
  topicsCount?: number;
}

export function useTopicDrop({ onDropOnTopic, topicPillsRef, topicsCount }: UseTopicDropOpts = {}) {
  const [activeDragTopicId, setActiveDragTopicId] = useState<number | 'all' | null>(null);
  const [pointerHoverKey, setPointerHoverKey] = useState<string | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const cursorRef = useRef<{ x: number; y: number }>({ x: -1, y: -1 });

  const updateScrollState = useCallback(() => {
    const el = topicPillsRef?.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, [topicPillsRef]);

  useEffect(() => {
    const el = topicPillsRef?.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateScrollState());
      ro.observe(el);
    }

    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => updateScrollState());
      mo.observe(el, { childList: true, subtree: true, characterData: true });
    }

    const t = setTimeout(updateScrollState, 80);

    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [topicPillsRef, updateScrollState, topicsCount]);

  useEffect(() => {
    const unsub = subscribeDriveDragUi(() => {
      const dragActive = isPointerDriveDragActive() || !!getActiveDriveDrag();
      const k = getLastHoverDropKey();
      if (!dragActive || !k) {
        setPointerHoverKey(null);
        setActiveDragTopicId(null);
        return;
      }
      setPointerHoverKey(k);
      if (k.startsWith('topic:')) {
        const idPart = k.slice('topic:'.length);
        if (idPart === 'all' || idPart === 'null') {
          setActiveDragTopicId('all');
        } else {
          const num = Number(idPart);
          if (Number.isFinite(num)) setActiveDragTopicId(num);
          else setActiveDragTopicId(null);
        }
      } else {
        setActiveDragTopicId(null);
      }
    });
    return unsub;
  }, []);

  // Track global cursor coordinates for smooth edge auto-scrolling during drag
  useEffect(() => {
    const onMove = (e: MouseEvent | PointerEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    window.addEventListener('mousemove', onMove, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('mousemove', onMove, { capture: true });
    };
  }, []);

  // Continuous edge auto-scroll loop while drag is active
  useEffect(() => {
    let rafId: number | null = null;

    const tick = () => {
      const dragActive = isPointerDriveDragActive() || !!getActiveDriveDrag();
      const el = topicPillsRef?.current;

      if (dragActive && el && el.scrollWidth > el.clientWidth) {
        const { x, y } = cursorRef.current;
        if (x >= 0 && y >= 0) {
          const rect = el.getBoundingClientRect();
          // Check if cursor is vertically over / near the topic pills strip
          if (y >= rect.top - 20 && y <= rect.bottom + 25) {
            const edgeZone = 80;
            // Right edge hover zone -> auto scroll right
            if (x >= rect.right - edgeZone && x <= rect.right + 40) {
              const depth = Math.min(1, Math.max(0.15, (x - (rect.right - edgeZone)) / edgeZone));
              el.scrollLeft += Math.max(3, Math.floor(depth * 18));
            }
            // Left edge hover zone -> auto scroll left
            else if (x <= rect.left + edgeZone && x >= rect.left - 40) {
              const depth = Math.min(1, Math.max(0.15, (rect.left + edgeZone - x) / edgeZone));
              el.scrollLeft -= Math.max(3, Math.floor(depth * 18));
            }
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [topicPillsRef]);

  const handlePillsWheel = useCallback(
    (_e: React.WheelEvent<HTMLDivElement>) => {
      // Native horizontal delta is handled natively by the browser.
      // Vertical mouse wheel delta is handled globally and smoothly by handleHorizontalWheel.
    },
    []
  );

  const handlePillsDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = topicPillsRef?.current;
      if (!el || el.scrollWidth <= el.clientWidth) return;
      const rect = el.getBoundingClientRect();
      const edgeZone = 80;
      if (e.clientX >= rect.right - edgeZone) {
        const depth = Math.min(1, Math.max(0.15, (e.clientX - (rect.right - edgeZone)) / edgeZone));
        el.scrollLeft += Math.max(3, Math.floor(depth * 18));
      } else if (e.clientX <= rect.left + edgeZone) {
        const depth = Math.min(1, Math.max(0.15, (rect.left + edgeZone - e.clientX) / edgeZone));
        el.scrollLeft -= Math.max(3, Math.floor(depth * 18));
      }
    },
    [topicPillsRef]
  );

  const scrollTopicsBy = useCallback(
    (px: number) => {
      const el = topicPillsRef?.current;
      if (!el) return;
      el.scrollBy({ left: px, behavior: 'smooth' });
    },
    [topicPillsRef]
  );

  const handleDragOver = useCallback((topicId: number | null, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    } catch {
      /* ignore */
    }
    const targetKey = topicId == null ? 'all' : topicId;
    setLastHoverDropKey(topicId == null ? 'topic:all' : `topic:${topicId}`);
    setActiveDragTopicId((prev) => (prev === targetKey ? prev : targetKey));
  }, []);

  const handleDragLeave = useCallback((topicId: number | null, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const targetKey = topicId == null ? 'all' : topicId;
    if (getLastHoverDropKey() === (topicId == null ? 'topic:all' : `topic:${topicId}`)) {
      setLastHoverDropKey(null);
    }
    setActiveDragTopicId((prev) => (prev === targetKey ? null : prev));
  }, []);

  const handleDrop = useCallback(
    (topicId: number | null, topicTitle: string, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setLastHoverDropKey(null);
      setActiveDragTopicId(null);

      // Pointer internal drag: Cloud Drives pointerup in MediaStudio owns completion
      if (isPointerDriveDragActive()) return;

      const internal = getActiveDriveDrag() || getDriveDragData(e.dataTransfer);
      if (!internal || !internal.messageIds || !internal.messageIds.length) {
        return;
      }

      onDropOnTopic?.(topicId, topicTitle, e);
    },
    [onDropOnTopic]
  );

  const { createHoldProps: createTopicHoldProps } = useHoldToScroll(topicPillsRef);

  return {
    activeDragTopicId,
    pointerHoverKey,
    canScrollLeft,
    canScrollRight,
    scrollTopicsBy,
    createTopicHoldProps,
    handlePillsWheel,
    handlePillsDragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}

/**
 * Universal hook for scroll buttons providing native scrollbar-arrow behavior:
 * - Single click / tap: immediate discrete step scroll
 * - Press & hold: continuous smooth 60fps scrolling while held down
 */
export function useHoldToScroll(targetRef?: React.RefObject<HTMLDivElement | null>) {
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopScrolling = useCallback(() => {
    if (holdTimerRef.current != null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const createHoldProps = useCallback(
    (direction: -1 | 1, stepPx: number = 140, speedPx: number = 12) => {
      const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        stopScrolling();

        const el = targetRef?.current;
        if (!el) return;

        // Immediate single click step
        el.scrollBy({ left: direction * stepPx, behavior: 'auto' });

        // Continuous scrolling on hold (starts after 200ms)
        holdTimerRef.current = setTimeout(() => {
          const tick = () => {
            const container = targetRef?.current;
            if (!container) {
              stopScrolling();
              return;
            }
            container.scrollLeft += direction * speedPx;
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }, 200);
      };

      return {
        onPointerDown: handlePointerDown,
        onPointerUp: stopScrolling,
        onPointerLeave: stopScrolling,
        onPointerCancel: stopScrolling,
        onClick: (e: React.MouseEvent) => e.preventDefault(),
      };
    },
    [targetRef, stopScrolling]
  );

  useEffect(() => {
    return () => {
      stopScrolling();
    };
  }, [stopScrolling]);

  return { createHoldProps, stopScrolling };
}
