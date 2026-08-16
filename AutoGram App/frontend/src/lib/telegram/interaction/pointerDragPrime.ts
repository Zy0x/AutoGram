/**
 * Pointer-drag arming for Drive cards/list rows.
 *
 * WebView2 / CDP mouse events often leave the element mid-gesture before
 * React's element-level onPointerMove sees the threshold. We:
 *  1) setPointerCapture on pointerdown
 *  2) also listen document-level pointermove until primed or released
 */
import { useCallback, useEffect, useRef } from 'react';
import { DRAG_THRESHOLD_PX } from '../interaction/driveDrag';
import type { DriveFile } from '../driveTypes';

type PrimeFn = (file: DriveFile, e: React.PointerEvent) => void;
type LongPressFn = (file: DriveFile, coords: { x: number; y: number }) => void;

export function usePointerDragPrime(
  file: DriveFile,
  onMediaDragPrime?: PrimeFn,
  onLongPress?: LongPressFn
) {
  const suppressClick = useRef(false);
  const pointerDown = useRef<{ x: number; y: number; id: number } | null>(null);
  const movedPastThreshold = useRef(false);
  const primed = useRef(false);
  const docCleanup = useRef<(() => void) | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const detachDoc = useCallback(() => {
    clearLongPress();
    if (docCleanup.current) {
      try {
        docCleanup.current();
      } catch {
        /* ignore */
      }
      docCleanup.current = null;
    }
  }, [clearLongPress]);

  useEffect(() => () => detachDoc(), [detachDoc]);

  const tryPrime = useCallback(
    (clientX: number, clientY: number, nativeEv: PointerEvent | React.PointerEvent) => {
      if (!pointerDown.current || primed.current) return;
      const dx = clientX - pointerDown.current.x;
      const dy = clientY - pointerDown.current.y;
      if (Math.hypot(dx, dy) >= 8) {
        clearLongPress();
      }
      if (!onMediaDragPrime) return;
      if (document.body.classList.contains('td-marquee-active')) {
        pointerDown.current = null;
        detachDoc();
        return;
      }
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      movedPastThreshold.current = true;
      primed.current = true;
      suppressClick.current = true;
      // Parent attaches window listeners + ghost; keep capture on the card
      onMediaDragPrime(file, nativeEv as React.PointerEvent);
    },
    [clearLongPress, detachDoc, file, onMediaDragPrime]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.ctrlKey || e.metaKey) {
        pointerDown.current = null;
        movedPastThreshold.current = false;
        primed.current = false;
        detachDoc();
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest('button, a, input, label')) {
        pointerDown.current = null;
        movedPastThreshold.current = false;
        primed.current = false;
        detachDoc();
        return;
      }
      if (e.button !== 0) return;

      detachDoc();
      pointerDown.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      movedPastThreshold.current = false;
      primed.current = false;

      // Arm long-press on touch / pointer hold
      if (onLongPress) {
        const startX = e.clientX;
        const startY = e.clientY;
        longPressTimerRef.current = window.setTimeout(() => {
          if (pointerDown.current && !movedPastThreshold.current && !primed.current) {
            try {
              navigator.vibrate?.(35);
            } catch {
              /* ignore */
            }
            suppressClick.current = true;
            onLongPress(file, { x: startX, y: startY });
          }
        }, 450);
      }

      // Capture ASAP so moves outside the card still hit this element (and React).
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      // Document capture path: works even when React element listeners miss CDP mouse.
      const pid = e.pointerId;
      const onDocMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        tryPrime(ev.clientX, ev.clientY, ev);
      };
      const onDocUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        detachDoc();
        // Release capture if we still hold it and never primed (plain click)
        if (!primed.current) {
          try {
            const el = e.currentTarget as HTMLElement;
            if (el.hasPointerCapture?.(pid)) el.releasePointerCapture(pid);
          } catch {
            /* ignore */
          }
          pointerDown.current = null;
          movedPastThreshold.current = false;
        }
      };
      document.addEventListener('pointermove', onDocMove, true);
      document.addEventListener('pointerup', onDocUp, true);
      document.addEventListener('pointercancel', onDocUp, true);
      // Mouse-only CDP fallback (some WebView builds skip pointermove)
      const onMouseMove = (ev: MouseEvent) => {
        if (ev.buttons !== 1) return;
        tryPrime(ev.clientX, ev.clientY, ev as unknown as PointerEvent);
      };
      document.addEventListener('mousemove', onMouseMove, true);
      docCleanup.current = () => {
        document.removeEventListener('pointermove', onDocMove, true);
        document.removeEventListener('pointerup', onDocUp, true);
        document.removeEventListener('pointercancel', onDocUp, true);
        document.removeEventListener('mousemove', onMouseMove, true);
      };
    },
    [detachDoc, tryPrime]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointerDown.current) return;
      tryPrime(e.clientX, e.clientY, e);
    },
    [tryPrime]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      detachDoc();
      pointerDown.current = null;
      if (!primed.current) {
        movedPastThreshold.current = false;
        try {
          const el = e.currentTarget as HTMLElement;
          if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
    },
    [detachDoc]
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      detachDoc();
      pointerDown.current = null;
      primed.current = false;
      movedPastThreshold.current = false;
      try {
        const el = e.currentTarget as HTMLElement;
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [detachDoc]
  );

  /** Call when parent reports drag ended (isDragSource false). */
  const resetAfterDrag = useCallback(() => {
    detachDoc();
    pointerDown.current = null;
    primed.current = false;
  }, [detachDoc]);

  return {
    suppressClick,
    movedPastThreshold,
    primed,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    resetAfterDrag,
  };
}
