/**
 * Cross-Platform Modal Back-Stack Manager
 * Handles Android Hardware / Gesture Back Button and Browser popstate
 * to gracefully dismiss top-most modals, dialogs, drawers, and menus.
 */
import { useEffect, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type ModalEntry = {
  id: string;
  onClose: () => void;
  isPopping?: boolean;
};

const backStack: ModalEntry[] = [];
let isInitialized = false;
let internalPopsRemaining = 0;

/**
 * Resets modal back stack state for testing environments.
 */
export function clearBackStackForTesting(): void {
  backStack.length = 0;
  internalPopsRemaining = 0;
}

function initBackStackListeners() {
  if (typeof window === 'undefined' || isInitialized) return;
  isInitialized = true;

  // 1. Web / PWA / Android WebView popstate
  window.addEventListener('popstate', () => {
    if (internalPopsRemaining > 0) {
      internalPopsRemaining--;
      return;
    }
    if (backStack.length > 0) {
      const top = backStack.pop();
      if (top) {
        top.isPopping = true;
        try {
          top.onClose();
        } catch (err) {
          console.warn('[ModalBackStack] Error closing modal on back:', err);
        }
      }
    }
  });

  // 2. Tauri Mobile native back-button event
  if (isTauri()) {
    try {
      void listen('tauri://back-button', () => {
        if (backStack.length > 0) {
          const top = backStack.pop();
          if (top) {
            top.isPopping = true;
            try {
              top.onClose();
            } catch (err) {
              console.warn('[ModalBackStack] Error closing modal on tauri back:', err);
            }
          }
        }
      });
    } catch {
      /* ignore if tauri event listener not supported in this runtime */
    }
  }
}

/**
 * Checks whether any modal or overlay is currently registered in the back stack.
 */
export function hasOpenModals(): boolean {
  return backStack.length > 0;
}

/**
 * Returns the current count of open modals in the back stack.
 */
export function getOpenModalCount(): number {
  return backStack.length;
}

/**
 * Pops and executes the top-most modal's onClose handler (LIFO).
 * Returns true if a modal was closed, or false if the stack was empty.
 */
export function popTopModal(): boolean {
  if (backStack.length > 0) {
    const top = backStack.pop();
    if (top) {
      top.isPopping = true;
      try {
        if (typeof window !== 'undefined' && window.history?.state?.autogramModal === top.id) {
          internalPopsRemaining++;
          window.history.back();
        }
        top.onClose();
        return true;
      } catch (err) {
        console.warn('[ModalBackStack] Error closing modal on popTopModal:', err);
        return true;
      }
    }
  }
  return false;
}

/**
 * Register a modal onto the back-stack when it opens.
 * Returns a cleanup function to call when the modal closes normally.
 */
export function registerModalBackHandler(id: string, onClose: () => void): () => void {
  initBackStackListeners();

  // Push history state if on browser/webview
  try {
    window.history.pushState({ autogramModal: id }, '');
  } catch {
    /* ignore */
  }

  const entry: ModalEntry = { id, onClose, isPopping: false };
  backStack.push(entry);

  return () => {
    const idx = backStack.findIndex((m) => m.id === id);
    if (idx !== -1) {
      const entry = backStack.splice(idx, 1)[0];
      // Only clean up the dummy history entry if this modal was closed by UI button rather than back gesture / popstate
      if (!entry.isPopping) {
        try {
          if (window.history.state?.autogramModal === id) {
            internalPopsRemaining++;
            window.history.back();
          }
        } catch {
          /* ignore */
        }
      }
    }
  };
}

/**
 * Hook to automatically bind a modal's open state to the Android back-stack.
 */
export function useModalBackHandler(isOpen: boolean, onClose: () => void, modalId: string) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    // Register once per open cycle. Inline callbacks commonly change identity
    // on every render; re-registering them pushes/pops browser history and can
    // dismiss a modal while its async content is still loading.
    const cleanup = registerModalBackHandler(modalId, () => onCloseRef.current());
    return cleanup;
  }, [isOpen, modalId]);
}
