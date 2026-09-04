/**
 * Universal Mouse Back & Forward Navigation & Gesture Engine for AutoGram.
 *
 * Provides comprehensive, unified handling for:
 * 1. Physical Mouse Buttons:
 *    - Button 3 (XButton1 / Back)
 *    - Button 4 (XButton2 / Forward)
 *    Listens to `auxclick` and `mouseup` with 250ms deduplication guard.
 * 2. Trackpad / Tilt-Wheel Horizontal Swipe Gestures:
 *    - deltaX < -40 (swipe right): Back Gesture
 *    - deltaX > 40 (swipe left): Forward Gesture
 *    Intelligently checks whether the cursor is over an active horizontally
 *    scrollable container; only triggers navigation when container is at its boundary.
 * 3. Mobile / Tablet Touch Edge Swipe:
 *    - Left-to-right swipe starting near the left edge (< 60px).
 * 4. Structured LIFO & Priority Resolution:
 *    - Priority 1: Top-most active modal/dialog via `modalBackStack.ts`.
 *    - Priority 2: Registered component / page back handlers.
 *    - Priority 3: Fallback workspace navigation (e.g. exit to launcher).
 */

import { useEffect, useRef } from 'react';
import { hasOpenModals, popTopModal } from './modalBackStack';
import { findHorizontalScrollContainer } from '../utils/horizontalWheelScroll';

export type BackHandler = () => boolean | void;
export type ForwardHandler = () => boolean | void;

export interface RegisteredNavHandler {
  id: string;
  onBack?: BackHandler;
  onForward?: ForwardHandler;
  priority: number;
  order: number;
}

const navHandlers: RegisteredNavHandler[] = [];
let nextHandlerOrder = 1;

let isGlobalListenerInitialized = false;
let cleanupGlobalListeners: (() => void) | null = null;

let lastMouseButtonTime = 0;
const MOUSE_BUTTON_DEDUPE_MS = 250;

let lastWheelGestureTime = 0;
const WHEEL_GESTURE_COOLDOWN_MS = 450;

let lastBackActionTime = 0;
const BACK_ACTION_COOLDOWN_MS = 300;

/**
 * Resets back gesture timestamps for testing environments.
 */
export function resetBackCooldownForTesting(): void {
  lastBackActionTime = 0;
  lastMouseButtonTime = 0;
  lastWheelGestureTime = 0;
}

/**
 * Registers a component or page-level back/forward navigation handler.
 * Handlers with higher priority execute first. For equal priority,
 * the most recently registered handler executes first (LIFO).
 *
 * If a handler returns `false`, execution continues to the next handler in the stack.
 * If a handler returns `true` or `undefined` (void), the navigation is marked as handled.
 */
export function registerBackNavigation(options: {
  id?: string;
  onBack?: BackHandler;
  onForward?: ForwardHandler;
  priority?: number;
}): () => void {
  const id = options.id || `nav-handler-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: RegisteredNavHandler = {
    id,
    onBack: options.onBack,
    onForward: options.onForward,
    priority: options.priority ?? 0,
    order: nextHandlerOrder++,
  };

  navHandlers.push(entry);

  return () => {
    const idx = navHandlers.findIndex((h) => h.id === id);
    if (idx !== -1) {
      navHandlers.splice(idx, 1);
    }
  };
}

/**
 * Sorts active navigation handlers by priority descending, then order descending (LIFO).
 */
function getSortedHandlers(): RegisteredNavHandler[] {
  return [...navHandlers].sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return b.order - a.order;
  });
}

/**
 * Triggers the global Back action through the unified hierarchy:
 * 1. Checks modal back stack: if any modal is open, pops & closes top modal.
 * 2. Iterates registered navigation handlers in priority/LIFO order.
 * Returns true if the back event was handled, false otherwise.
 */
export function triggerGlobalBack(): boolean {
  const now = Date.now();
  if (now - lastBackActionTime < BACK_ACTION_COOLDOWN_MS) {
    return true; // Cooldown in progress, suppress rapid double clicks / simultaneous events
  }

  // 1. Top-most modal in modalBackStack
  if (hasOpenModals()) {
    const closed = popTopModal();
    if (closed) {
      lastBackActionTime = Date.now();
      return true;
    }
  }

  // 2. Component / Page level handlers
  const sorted = getSortedHandlers();
  for (const handler of sorted) {
    if (handler.onBack) {
      try {
        const result = handler.onBack();
        // If handler explicitly returned false, fall through to next handler
        if (result !== false) {
          lastBackActionTime = Date.now();
          return true;
        }
      } catch (err) {
        console.warn(`[MouseBackGesture] Error in handler ${handler.id}:`, err);
        lastBackActionTime = Date.now();
        return true;
      }
    }
  }

  return false;
}

/**
 * Triggers the global Forward action through registered navigation handlers.
 * Returns true if the forward event was handled, false otherwise.
 */
export function triggerGlobalForward(): boolean {
  const sorted = getSortedHandlers();
  for (const handler of sorted) {
    if (handler.onForward) {
      try {
        const result = handler.onForward();
        if (result !== false) {
          return true;
        }
      } catch (err) {
        console.warn(`[MouseBackGesture] Error in forward handler ${handler.id}:`, err);
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks whether a wheel event represents a valid horizontal back/forward swipe
 * without interfering with scrollable content.
 */
function canTriggerWheelSwipe(e: WheelEvent, direction: 'back' | 'forward'): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
    return false;
  }

  const container = findHorizontalScrollContainer(e.target, e.deltaX);
  if (!container) {
    return true;
  }

  const scrollLeft = container.scrollLeft || 0;
  const maxScrollLeft = (container.scrollWidth || 0) - (container.clientWidth || 0);

  if (direction === 'back') {
    // If container can still scroll left, do NOT hijack as back gesture
    return scrollLeft <= 2;
  } else {
    // If container can still scroll right, do NOT hijack as forward gesture
    return scrollLeft >= maxScrollLeft - 2;
  }
}

/**
 * Initializes global window listeners for Mouse Buttons 3/4, Trackpad Horizontal Swipe,
 * and Touch Screen Edge Swipe.
 * Safe to call multiple times (idempotent).
 */
export function initGlobalMouseBackGesture(): () => void {
  if (typeof window === 'undefined' || isGlobalListenerInitialized) {
    return cleanupGlobalListeners || (() => {});
  }

  isGlobalListenerInitialized = true;

  // 1. Mouse Button 3 (Back) and Button 4 (Forward)
  const handleMouseButton = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) {
      const now = Date.now();
      if (now - lastMouseButtonTime < MOUSE_BUTTON_DEDUPE_MS) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      lastMouseButtonTime = now;

      e.preventDefault();
      e.stopPropagation();

      if (e.button === 3) {
        triggerGlobalBack();
      } else if (e.button === 4) {
        triggerGlobalForward();
      }
    }
  };

  // 2. Trackpad / Wheel Horizontal Swipe Gesture
  const handleWheelGesture = (e: WheelEvent) => {
    // Two-finger horizontal swipe: dominant deltaX with small deltaY
    if (Math.abs(e.deltaX) > 40 && Math.abs(e.deltaY) < 25) {
      const now = Date.now();
      if (now - lastWheelGestureTime < WHEEL_GESTURE_COOLDOWN_MS) {
        return;
      }

      // Back Gesture: swipe right (deltaX < -40)
      if (e.deltaX < -40) {
        if (canTriggerWheelSwipe(e, 'back')) {
          lastWheelGestureTime = now;
          const handled = triggerGlobalBack();
          if (handled && e.cancelable) {
            e.preventDefault();
          }
        }
      }
      // Forward Gesture: swipe left (deltaX > 40)
      else if (e.deltaX > 40) {
        if (canTriggerWheelSwipe(e, 'forward')) {
          lastWheelGestureTime = now;
          const handled = triggerGlobalForward();
          if (handled && e.cancelable) {
            e.preventDefault();
          }
        }
      }
    }
  };

  // 3. Touch Screen Edge Swipe (Mobile / Tablet)
  let touchStart: { x: number; y: number; time: number } | null = null;

  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      touchStart = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (!touchStart || e.changedTouches.length === 0) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    const elapsed = Date.now() - touchStart.time;
    const startX = touchStart.x;
    touchStart = null;

    // Left edge swipe to right: startX <= 60, dx > 55, vertical displacement < 45, within 450ms
    if (startX <= 60 && dx > 55 && Math.abs(dy) < 45 && elapsed < 450) {
      triggerGlobalBack();
    }
  };

  window.addEventListener('auxclick', handleMouseButton, true);
  window.addEventListener('mouseup', handleMouseButton, true);
  window.addEventListener('wheel', handleWheelGesture, { passive: false });
  window.addEventListener('touchstart', handleTouchStart, { passive: true });
  window.addEventListener('touchend', handleTouchEnd, { passive: true });

  cleanupGlobalListeners = () => {
    window.removeEventListener('auxclick', handleMouseButton, true);
    window.removeEventListener('mouseup', handleMouseButton, true);
    window.removeEventListener('wheel', handleWheelGesture);
    window.removeEventListener('touchstart', handleTouchStart);
    window.removeEventListener('touchend', handleTouchEnd);
    isGlobalListenerInitialized = false;
    cleanupGlobalListeners = null;
  };

  return cleanupGlobalListeners;
}

/**
 * React Hook to attach mouse back and forward navigation to a component.
 */
export function useMouseBackNavigation(
  optionsOrHandler: BackHandler | {
    onBack?: BackHandler;
    onForward?: ForwardHandler;
    priority?: number;
    enabled?: boolean;
  },
  deps: any[] = []
) {
  const options = typeof optionsOrHandler === 'function'
    ? { onBack: optionsOrHandler, enabled: true, priority: 0 }
    : optionsOrHandler;

  const { onBack, onForward, priority = 0, enabled = true } = options;

  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const onForwardRef = useRef(onForward);
  onForwardRef.current = onForward;

  useEffect(() => {
    if (!enabled) return;

    const cleanup = registerBackNavigation({
      onBack: onBackRef.current ? () => onBackRef.current?.() : undefined,
      onForward: onForwardRef.current ? () => onForwardRef.current?.() : undefined,
      priority,
    });

    return cleanup;
  }, [enabled, priority, ...deps]);
}
