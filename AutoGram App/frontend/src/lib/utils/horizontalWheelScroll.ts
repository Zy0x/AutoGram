/**
 * Universal Horizontal Mouse Wheel Scroll Utility & Standard for AutoGram.
 * Translates vertical mouse wheel rotation (deltaY) into horizontal scrolling (scrollLeft)
 * when hovering over any horizontally scrollable container across the app.
 *
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

  const hasHorizontalOverflow = (el.scrollWidth || 0) > (el.clientWidth || 0) + 2;
  if (!hasHorizontalOverflow) return false;

  if (typeof window === 'undefined' || !window.getComputedStyle) return false;
  const style = window.getComputedStyle(el);
  if (!style) return false;

  const overflowX = style.overflowX;
  const isScrollableX = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';
  if (!isScrollableX) return false;

  // Check if it is a single-axis horizontal container or has no significant vertical scroll
  const overflowY = style.overflowY;
  const isVerticalScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
    ((el.scrollHeight || 0) > (el.clientHeight || 0) + 4);

  // If both X and Y are scrollable and it's a large 2D pane (not a compact horizontal strip),
  // let standard 2D scroll apply unless marked with data-horizontal-scroll
  if (isVerticalScrollable && (el.clientHeight || 0) > 140 && !el.dataset?.horizontalScroll) {
    return false;
  }

  // Check direction boundaries:
  // Scrolling right (deltaY > 0): must not already be at maximum right
  if (deltaY > 0 && el.scrollLeft < el.scrollWidth - el.clientWidth - 1) {
    return true;
  }

  // Scrolling left (deltaY < 0): must not already be at maximum left (0)
  if (deltaY < 0 && el.scrollLeft > 0) {
    return true;
  }

  return false;
}

/**
 * Finds the closest horizontally scrollable ancestor starting from target element.
 */
export function findHorizontalScrollContainer(target: EventTarget | null, deltaY: number): HTMLElement | null {
  if (!target) return null;
  const isHtmlElement = typeof HTMLElement !== 'undefined'
    ? target instanceof HTMLElement
    : Boolean(target && typeof target === 'object' && 'scrollWidth' in target);

  let curr: HTMLElement | null = isHtmlElement ? (target as HTMLElement) : null;

  while (curr) {
    if (typeof document !== 'undefined') {
      if (curr === document.body || curr === document.documentElement) break;
    }
    if (isHorizontallyScrollable(curr, deltaY)) {
      return curr;
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

  // Prevent vertical page scroll bounce while hovering over horizontal strip
  if (e.cancelable && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }

  // Smoothly scroll container horizontally
  container.scrollLeft += deltaPx;
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
