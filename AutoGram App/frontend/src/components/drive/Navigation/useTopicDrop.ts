import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getActiveDriveDrag,
  getLastHoverDropKey,
  isPointerDriveDragActive,
  setLastHoverDropKey,
  subscribeDriveDragUi,
} from '../../../lib/telegram';

export interface UseTopicDropOpts {
  onDropOnTopic?: (topicId: number | null, topicTitle: string, e: React.DragEvent) => void;
  onTopicHoverSwitch?: (topicId: number | null) => void;
  topicPillsRef?: React.RefObject<HTMLDivElement | null>;
  topicsCount?: number;
}

export function useTopicDrop({
  onDropOnTopic,
  onTopicHoverSwitch,
  topicPillsRef,
  topicsCount,
}: UseTopicDropOpts = {}) {
  const [activeDragTopicId, setActiveDragTopicId] = useState<number | 'all' | null>(null);
  const [springHoverTopicId, setSpringHoverTopicId] = useState<number | 'all' | null>(null);
  const [pointerHoverKey, setPointerHoverKey] = useState<string | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const cursorRef = useRef<{ x: number; y: number }>({ x: -1, y: -1 });
  const isExternalDragActiveRef = useRef(false);
  const springTimerRef = useRef<NodeJS.Timeout | null>(null);
  const leaveGraceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastHoveredTopicRef = useRef<number | 'all' | null>(null);

  const onTopicHoverSwitchRef = useRef(onTopicHoverSwitch);
  onTopicHoverSwitchRef.current = onTopicHoverSwitch;

  const clearSpringTimer = useCallback(() => {
    if (leaveGraceTimerRef.current) {
      clearTimeout(leaveGraceTimerRef.current);
      leaveGraceTimerRef.current = null;
    }
    if (springTimerRef.current) {
      clearTimeout(springTimerRef.current);
      springTimerRef.current = null;
    }
    setSpringHoverTopicId(null);
    lastHoveredTopicRef.current = null;
  }, []);

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
      const dragActive =
        isPointerDriveDragActive() ||
        !!getActiveDriveDrag() ||
        isExternalDragActiveRef.current ||
        (typeof document !== 'undefined' && (
          document.body.classList.contains('td-dnd-external') ||
          document.querySelector('.td-shell.is-os-dnd') != null
        ));
      const k = getLastHoverDropKey();
      if (!dragActive) {
        setPointerHoverKey(null);
        setActiveDragTopicId(null);
        clearSpringTimer();
        return;
      }
      if (!k) {
        setPointerHoverKey(null);
        setActiveDragTopicId(null);
        // Micro-grace timer before clearing spring state (avoids cancelling on 1px pill border transitions)
        if (!leaveGraceTimerRef.current && springTimerRef.current) {
          leaveGraceTimerRef.current = setTimeout(() => {
            leaveGraceTimerRef.current = null;
            clearSpringTimer();
          }, 120);
        }
        return;
      }

      if (leaveGraceTimerRef.current) {
        clearTimeout(leaveGraceTimerRef.current);
        leaveGraceTimerRef.current = null;
      }

      setPointerHoverKey(k);
      if (k.startsWith('topic:')) {
        const idPart = k.slice('topic:'.length);
        const parsedKey: number | 'all' = idPart === 'all' || idPart === 'null' ? 'all' : Number(idPart);
        const validKey = parsedKey === 'all' ? 'all' : Number.isFinite(parsedKey) ? parsedKey : null;
        setActiveDragTopicId(validKey);

        // Spring-loaded topic switch with calibrated 550ms debounce
        if (validKey != null && lastHoveredTopicRef.current !== validKey) {
          if (springTimerRef.current) clearTimeout(springTimerRef.current);
          lastHoveredTopicRef.current = validKey;
          setSpringHoverTopicId(validKey);
          springTimerRef.current = setTimeout(() => {
            springTimerRef.current = null;
            setSpringHoverTopicId(null);
            onTopicHoverSwitchRef.current?.(validKey === 'all' ? null : validKey);
          }, 550);
        }
      } else {
        setActiveDragTopicId(null);
        clearSpringTimer();
      }
    });
    return () => {
      unsub();
      clearSpringTimer();
    };
  }, [clearSpringTimer]);

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

  // Track external OS file drag states
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        isExternalDragActiveRef.current = true;
      }
    };
    const onDragOver = (e: DragEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        isExternalDragActiveRef.current = true;
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        isExternalDragActiveRef.current = false;
        clearSpringTimer();
      }
    };
    const onDropEnd = () => {
      isExternalDragActiveRef.current = false;
      clearSpringTimer();
    };
    window.addEventListener('dragenter', onDragEnter, { capture: true, passive: true });
    window.addEventListener('dragover', onDragOver, { capture: true, passive: true });
    window.addEventListener('dragleave', onDragLeave, { capture: true, passive: true });
    window.addEventListener('drop', onDropEnd, { capture: true, passive: true });
    window.addEventListener('dragend', onDropEnd, { capture: true, passive: true });
    return () => {
      window.removeEventListener('dragenter', onDragEnter, { capture: true });
      window.removeEventListener('dragover', onDragOver, { capture: true });
      window.removeEventListener('dragleave', onDragLeave, { capture: true });
      window.removeEventListener('drop', onDropEnd, { capture: true });
      window.removeEventListener('dragend', onDropEnd, { capture: true });
    };
  }, [clearSpringTimer]);

  // Listen to native OS drag move/end events emitted from Tauri onNativeDrag
  useEffect(() => {
    const onOsDragMove = (e: Event) => {
      const detail = (e as CustomEvent).detail as { clientX: number; clientY: number } | undefined;
      if (detail && typeof detail.clientX === 'number') {
        cursorRef.current = { x: detail.clientX, y: detail.clientY };
        isExternalDragActiveRef.current = true;

        // Instantaneous hit-test on topic pills during native OS drag
        const hit = typeof document !== 'undefined' ? document.elementFromPoint(detail.clientX, detail.clientY) : null;
        const pill = hit?.closest<HTMLElement>('.td-topic-pill[data-drop-key]');
        if (pill) {
          const k = pill.getAttribute('data-drop-key');
          if (k) {
            setLastHoverDropKey(k);
          }
        } else {
          const currentKey = getLastHoverDropKey();
          if (currentKey && currentKey.startsWith('topic:')) {
            setLastHoverDropKey(null);
          }
        }
      }
    };
    const onOsDragEnd = () => {
      isExternalDragActiveRef.current = false;
      clearSpringTimer();
    };
    window.addEventListener('autogram-os-drag-move', onOsDragMove);
    window.addEventListener('autogram-os-drag-end', onOsDragEnd);
    return () => {
      window.removeEventListener('autogram-os-drag-move', onOsDragMove);
      window.removeEventListener('autogram-os-drag-end', onOsDragEnd);
    };
  }, [clearSpringTimer]);

  // Continuous edge auto-scroll loop while drag is active (internal or external)
  useEffect(() => {
    let rafId: number | null = null;

    const tick = () => {
      const dragActive =
        isPointerDriveDragActive() ||
        !!getActiveDriveDrag() ||
        isExternalDragActiveRef.current ||
        (typeof document !== 'undefined' && (
          document.body.classList.contains('td-dnd-external') ||
          document.querySelector('.td-shell.is-os-dnd') != null
        ));
      const el = topicPillsRef?.current;

      if (dragActive && el && el.scrollWidth > el.clientWidth) {
        const { x, y } = cursorRef.current;
        if (x >= 0 && y >= 0) {
          const rect = el.getBoundingClientRect();
          // Check if cursor is vertically over / near the topic pills strip
          if (y >= rect.top - 25 && y <= rect.bottom + 30) {
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
    (e: React.WheelEvent<HTMLDivElement>) => {
      const el = topicPillsRef?.current;
      if (!el) return;
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) && e.deltaY !== 0) {
        el.scrollLeft += e.deltaY;
      }
    },
    [topicPillsRef]
  );

  const handlePillsDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      cursorRef.current = { x: e.clientX, y: e.clientY };
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

  const handleDragOver = useCallback(
    (topicId: number | null, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      cursorRef.current = { x: e.clientX, y: e.clientY };
      try {
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }
      } catch {
        /* ignore */
      }
      if (leaveGraceTimerRef.current) {
        clearTimeout(leaveGraceTimerRef.current);
        leaveGraceTimerRef.current = null;
      }
      const targetKey: number | 'all' = topicId == null ? 'all' : topicId;
      setLastHoverDropKey(topicId == null ? 'topic:all' : `topic:${topicId}`);
      setActiveDragTopicId((prev) => (prev === targetKey ? prev : targetKey));

      // Spring-loaded topic hover switch: start 550ms debounce timer if hovered over a new topic
      if (lastHoveredTopicRef.current !== targetKey) {
        if (springTimerRef.current) clearTimeout(springTimerRef.current);
        lastHoveredTopicRef.current = targetKey;
        setSpringHoverTopicId(targetKey);
        springTimerRef.current = setTimeout(() => {
          springTimerRef.current = null;
          setSpringHoverTopicId(null);
          onTopicHoverSwitchRef.current?.(topicId);
        }, 550);
      }
    },
    []
  );

  const handleDragLeave = useCallback(
    (topicId: number | null, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Ignore if pointer merely entered a child element inside the pill button
      if (e.currentTarget && e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
        return;
      }
      const targetKey: number | 'all' = topicId == null ? 'all' : topicId;
      if (getLastHoverDropKey() === (topicId == null ? 'topic:all' : `topic:${topicId}`)) {
        setLastHoverDropKey(null);
      }
      setActiveDragTopicId((prev) => (prev === targetKey ? null : prev));
      if (lastHoveredTopicRef.current === targetKey) {
        if (!leaveGraceTimerRef.current && springTimerRef.current) {
          leaveGraceTimerRef.current = setTimeout(() => {
            leaveGraceTimerRef.current = null;
            clearSpringTimer();
          }, 120);
        }
      }
    },
    [clearSpringTimer]
  );

  const handleDrop = useCallback(
    (topicId: number | null, topicTitle: string, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setLastHoverDropKey(null);
      setActiveDragTopicId(null);
      clearSpringTimer();

      // Pointer internal drag: Cloud Drives pointerup in MediaStudio owns completion
      if (isPointerDriveDragActive()) return;

      onDropOnTopic?.(topicId, topicTitle, e);
    },
    [onDropOnTopic, clearSpringTimer]
  );

  const { createHoldProps: createTopicHoldProps } = useHoldToScroll(topicPillsRef);

  return {
    activeDragTopicId,
    springHoverTopicId,
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
