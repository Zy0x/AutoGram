/**
 * Universal Horizontal Mouse Wheel Scroll Utility & Standard for AutoGram.
 * Translates vertical mouse wheel rotation (deltaY) into horizontal scrolling (scrollLeft)
 * when hovering over any horizontally scrollable container across the app.
 *
 * Full support for HTML elements, SVG icons (<svg>, <path>), and nested controls.
 * Designed for mouse users without a trackpad / horizontal tilt wheel.
 */

/**
 * Checks if a given HTMLElement is currently horizontally scrollable in the requested direction.
 */
export function isHorizontallyScrollable(el: HTMLElement, deltaY: number): boolean {
  if (!el) return false;
  if (typeof document !== 'undefined') {
    if (el === document.body || el === document.documentElement) return false;
  }

  const scrollWidth = el.scrollWidth || 0;
  const clientWidth = el.clientWidth || 0;
  const hasHorizontalOverflow = scrollWidth > clientWidth + 2;
  if (!hasHorizontalOverflow) return false;

  if (typeof window === 'undefined' || !window.getComputedStyle) return false;
  const style = window.getComputedStyle(el);
  if (!style) return false;

  const overflowX = style.overflowX;
  const isScrollableX = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';
  if (!isScrollableX) return false;

  // Check if it is a single-axis horizontal container or has no significant vertical scroll
  const overflowY = style.overflowY;
  const scrollHeight = el.scrollHeight || 0;
  const clientHeight = el.clientHeight || 0;
  const isVerticalScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
    (scrollHeight > clientHeight + 4);

  // If both X and Y are scrollable and it's a large 2D pane (not a compact horizontal strip),
  // let standard 2D scroll apply unless explicitly marked with data-horizontal-scroll
  if (isVerticalScrollable && clientHeight > 140 && !el.dataset?.horizontalScroll) {
    return false;
  }

  const currentScrollLeft = el.scrollLeft || 0;
  const maxScrollLeft = scrollWidth - clientWidth;

  // Check direction boundaries:
  // Scrolling right (deltaY > 0): must not already be at maximum right (with 1px threshold)
  if (deltaY > 0 && currentScrollLeft < maxScrollLeft - 1) {
    return true;
  }

  // Scrolling left (deltaY < 0): must not already be at maximum left (0, with 1px threshold)
  if (deltaY < 0 && currentScrollLeft > 0.5) {
    return true;
  }

  return false;
}

/**
 * Finds the closest horizontally scrollable ancestor starting from target element.
 * Seamlessly handles SVG elements (<svg>, <path>, <g>), buttons, spans, and HTML elements.
 */
export function findHorizontalScrollContainer(target: EventTarget | null, deltaY: number): HTMLElement | null {
  if (!target) return null;

  let curr: Element | null = null;
  if (typeof Element !== 'undefined' && target instanceof Element) {
    curr = target;
  } else if (typeof Node !== 'undefined' && target instanceof Node) {
    curr = target.parentElement;
  } else if (target && typeof target === 'object' && 'parentElement' in target) {
    curr = target as Element;
  }

  while (curr) {
    if (typeof document !== 'undefined') {
      if (curr === document.body || curr === document.documentElement) break;
    }

    if (
      (typeof HTMLElement !== 'undefined' && curr instanceof HTMLElement) ||
      (typeof (curr as any).scrollWidth === 'number' && typeof (curr as any).clientWidth === 'number')
    ) {
      if (isHorizontallyScrollable(curr as HTMLElement, deltaY)) {
        return curr as HTMLElement;
      }
    }

    curr = curr.parentElement;
  }

  return null;
}

/**
 * Handles mouse wheel event by translating deltaY to scrollLeft on the matching container.
 * Returns true if the wheel event was intercepted and translated.
 */
export function handleHorizontalWheel(e: WheelEvent): boolean {
  if (!e) return false;

  // Ignore pinch-to-zoom (Ctrl/Meta + Wheel), Alt-key modifiers, or Shift-key (native horizontal scroll)
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
    return false;
  }

  // If user is performing genuine horizontal delta (e.g. 2-finger trackpad horizontal gesture)
  if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) {
    return false;
  }

  const deltaY = e.deltaY;
  if (!deltaY) return false;

  const container = findHorizontalScrollContainer(e.target, deltaY);
  if (!container) return false;

  // Convert delta to pixels based on deltaMode
  let deltaPx = deltaY;
  const lineMode = typeof WheelEvent !== 'undefined' ? WheelEvent.DOM_DELTA_LINE : 1;
  const pageMode = typeof WheelEvent !== 'undefined' ? WheelEvent.DOM_DELTA_PAGE : 2;

  if (e.deltaMode === lineMode) {
    deltaPx = deltaY * 36;
  } else if (e.deltaMode === pageMode) {
    deltaPx = deltaY * container.clientWidth;
  }

  // Prevent vertical page scroll bounce / jitter while hovering over horizontal strip
  if (e.cancelable && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }

  // Smoothly scroll container horizontally
  if (typeof container.scrollBy === 'function') {
    container.scrollBy({ left: deltaPx, behavior: 'auto' });
  } else {
    container.scrollLeft += deltaPx;
  }
  return true;
}

/**
 * Initializes global window-level wheel listener for all horizontal scroll areas.
 * Returns cleanup function to unregister listener.
 */
export function initGlobalHorizontalWheelScroll(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onGlobalWheel = (e: WheelEvent) => {
    handleHorizontalWheel(e);
  };

  window.addEventListener('wheel', onGlobalWheel, { capture: true, passive: false });

  return () => {
    window.removeEventListener('wheel', onGlobalWheel, true);
  };
}
