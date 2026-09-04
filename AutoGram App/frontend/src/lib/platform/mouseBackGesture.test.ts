import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initGlobalMouseBackGesture,
  registerBackNavigation,
  triggerGlobalBack,
  triggerGlobalForward,
} from './mouseBackGesture';
import { registerModalBackHandler } from './modalBackStack';

describe('mouseBackGesture Engine', () => {
  let unregisterGlobal: (() => void) | null = null;
  const originalWindow = (globalThis as any).window;
  const eventListeners: Record<string, Function[]> = {};

  beforeEach(() => {
    vi.clearAllMocks();

    // Ensure mock window exists in Node test runner
    (globalThis as any).window = {
      addEventListener: vi.fn((type: string, handler: Function) => {
        if (!eventListeners[type]) eventListeners[type] = [];
        eventListeners[type].push(handler);
      }),
      removeEventListener: vi.fn((type: string, handler: Function) => {
        if (eventListeners[type]) {
          eventListeners[type] = eventListeners[type].filter((h) => h !== handler);
        }
      }),
      dispatchEvent: vi.fn((event: any) => {
        const handlers = eventListeners[event.type] || [];
        handlers.forEach((h) => h(event));
        return !event.defaultPrevented;
      }),
    };
  });

  afterEach(() => {
    if (unregisterGlobal) {
      unregisterGlobal();
      unregisterGlobal = null;
    }
    for (const key of Object.keys(eventListeners)) {
      delete eventListeners[key];
    }
    (globalThis as any).window = originalWindow;
  });

  it('triggers registered back handler on triggerGlobalBack', () => {
    const onBack = vi.fn(() => true);
    const unregister = registerBackNavigation({ onBack });

    const handled = triggerGlobalBack();
    expect(handled).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);

    unregister();
  });

  it('respects LIFO order for equal priority handlers', () => {
    const order: number[] = [];
    const unregister1 = registerBackNavigation({
      onBack: () => {
        order.push(1);
        return true;
      },
      priority: 0,
    });
    const unregister2 = registerBackNavigation({
      onBack: () => {
        order.push(2);
        return true;
      },
      priority: 0,
    });

    triggerGlobalBack();
    // Handlers with equal priority: most recently registered (LIFO) executes first
    expect(order).toEqual([2]);

    unregister1();
    unregister2();
  });

  it('falls through to lower priority handler if higher priority returns false', () => {
    const order: number[] = [];
    const unregisterLow = registerBackNavigation({
      onBack: () => {
        order.push(1);
        return true;
      },
      priority: 0,
    });
    const unregisterHigh = registerBackNavigation({
      onBack: () => {
        order.push(2);
        return false; // Yield to lower priority / next in stack
      },
      priority: 10,
    });

    const handled = triggerGlobalBack();
    expect(handled).toBe(true);
    expect(order).toEqual([2, 1]);

    unregisterLow();
    unregisterHigh();
  });

  it('delegates to modalBackStack when a modal is open', () => {
    const modalClose = vi.fn();
    const pageBack = vi.fn(() => true);

    const unregisterModal = registerModalBackHandler('test-modal', modalClose);
    const unregisterPage = registerBackNavigation({ onBack: pageBack, priority: 100 });

    const handled = triggerGlobalBack();
    expect(handled).toBe(true);
    expect(modalClose).toHaveBeenCalledTimes(1);
    // Page back should NOT be called because modal intercepted it
    expect(pageBack).not.toHaveBeenCalled();

    unregisterModal();
    unregisterPage();
  });

  it('handles Forward navigation via triggerGlobalForward', () => {
    const onForward = vi.fn(() => true);
    const unregister = registerBackNavigation({ onForward });

    const handled = triggerGlobalForward();
    expect(handled).toBe(true);
    expect(onForward).toHaveBeenCalledTimes(1);

    unregister();
  });

  it('dispatches mouse button 3 (Back) on auxclick and mouseup with deduplication', () => {
    unregisterGlobal = initGlobalMouseBackGesture();

    const onBack = vi.fn(() => true);
    const unregister = registerBackNavigation({ onBack });

    const mockAux = {
      type: 'auxclick',
      button: 3,
      cancelable: true,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    (globalThis as any).window.dispatchEvent(mockAux);
    expect(onBack).toHaveBeenCalledTimes(1);

    // Rapid mouseup event (within 250ms dedupe window) should be ignored
    const mockUp = {
      type: 'mouseup',
      button: 3,
      cancelable: true,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    (globalThis as any).window.dispatchEvent(mockUp);
    expect(onBack).toHaveBeenCalledTimes(1);

    unregister();
  });

  it('dispatches horizontal trackpad swipe right (deltaX < -40) as Back gesture', () => {
    unregisterGlobal = initGlobalMouseBackGesture();

    const onBack = vi.fn(() => true);
    const unregister = registerBackNavigation({ onBack });

    const mockWheel = {
      type: 'wheel',
      deltaX: -55,
      deltaY: 4,
      cancelable: true,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    (globalThis as any).window.dispatchEvent(mockWheel);

    expect(onBack).toHaveBeenCalledTimes(1);

    unregister();
  });
});
