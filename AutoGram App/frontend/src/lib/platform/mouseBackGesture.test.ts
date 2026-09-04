import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initGlobalMouseBackGesture,
  registerBackNavigation,
  triggerGlobalBack,
  triggerGlobalForward,
  resetBackCooldownForTesting,
} from './mouseBackGesture';
import { registerModalBackHandler, clearBackStackForTesting } from './modalBackStack';

describe('mouseBackGesture Engine', () => {
  let unregisterGlobal: (() => void) | null = null;
  const originalWindow = (globalThis as any).window;
  const eventListeners: Record<string, Function[]> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    resetBackCooldownForTesting();
    clearBackStackForTesting();

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
    resetBackCooldownForTesting();
    clearBackStackForTesting();
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

  it('enforces multi-tier nested overlay peeling (1 back gesture = 1 innermost layer only)', () => {
    // Simulate: MediaStudio (priority 20) -> DrivePreviewModal (priority 30) -> DriveZipBrowser (priority 40) -> ZipExtractModal (modalBackStack)
    const mediaStudioAction = vi.fn(() => true);
    const previewModalAction = vi.fn(() => true);
    const zipBrowserAction = vi.fn(() => true);
    const extractModalClose = vi.fn();

    const unregPage = registerBackNavigation({ onBack: mediaStudioAction, priority: 20 });
    const unregPreview = registerBackNavigation({ onBack: previewModalAction, priority: 30 });
    const unregZip = registerBackNavigation({ onBack: zipBrowserAction, priority: 40 });
    const unregExtract = registerModalBackHandler('zip-extract-modal', extractModalClose);

    // 1st back: MUST close ONLY the innermost extract modal
    expect(triggerGlobalBack()).toBe(true);
    expect(extractModalClose).toHaveBeenCalledTimes(1);
    expect(zipBrowserAction).not.toHaveBeenCalled();
    expect(previewModalAction).not.toHaveBeenCalled();
    expect(mediaStudioAction).not.toHaveBeenCalled();

    // Simulate extract modal unmounted
    unregExtract();
    resetBackCooldownForTesting();

    // 2nd back: MUST trigger ONLY the zip browser action
    expect(triggerGlobalBack()).toBe(true);
    expect(zipBrowserAction).toHaveBeenCalledTimes(1);
    expect(previewModalAction).not.toHaveBeenCalled();
    expect(mediaStudioAction).not.toHaveBeenCalled();

    // Simulate zip browser closed / unmounted
    unregZip();
    resetBackCooldownForTesting();

    // 3rd back: MUST trigger ONLY the preview modal action
    expect(triggerGlobalBack()).toBe(true);
    expect(previewModalAction).toHaveBeenCalledTimes(1);
    expect(mediaStudioAction).not.toHaveBeenCalled();

    // Simulate preview modal closed / unmounted
    unregPreview();
    resetBackCooldownForTesting();

    // 4th back: MUST trigger MediaStudio workspace navigation
    expect(triggerGlobalBack()).toBe(true);
    expect(mediaStudioAction).toHaveBeenCalledTimes(1);

    unregPage();
  });

  it('prevents double triggering within the 300ms action cooldown window', () => {
    const onBack = vi.fn(() => true);
    const unregister = registerBackNavigation({ onBack });

    // First call executes
    expect(triggerGlobalBack()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);

    // Immediate second call should be absorbed by the cooldown guard
    expect(triggerGlobalBack()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);

    unregister();
  });

  it('returns false when at root of drives and no handlers handle the back action (stays in drives, no-op)', () => {
    // Drives handler at root returns false (meaning: no modals, no selection, no folder parent)
    const drivesRootHandler = vi.fn(() => false);
    const unregisterDrives = registerBackNavigation({ onBack: drivesRootHandler, priority: 20 });

    // Fallback handler in App.tsx (priority -100) also returns false for drives mode
    const appFallbackHandler = vi.fn(() => false);
    const unregisterApp = registerBackNavigation({ onBack: appFallbackHandler, priority: -100 });

    // triggerGlobalBack should return false (no-op, staying strictly in drives)
    const handled = triggerGlobalBack();
    expect(handled).toBe(false);
    expect(drivesRootHandler).toHaveBeenCalledTimes(1);
    expect(appFallbackHandler).toHaveBeenCalledTimes(1);

    unregisterDrives();
    unregisterApp();
  });
});
