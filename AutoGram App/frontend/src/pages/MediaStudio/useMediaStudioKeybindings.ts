import { useEffect } from 'react';

type KeybindingsOpts = {
  onClosePreview?: () => void;
  onCloseModals?: () => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onRefresh?: () => void;
};

export function useMediaStudioKeybindings(opts: KeybindingsOpts) {
  const { onClosePreview, onCloseModals, onSelectAll, onClearSelection, onRefresh } = opts;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') {
        onClosePreview?.();
        onCloseModals?.();
        onClearSelection?.();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        onSelectAll?.();
      } else if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        onRefresh?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClosePreview, onCloseModals, onSelectAll, onClearSelection, onRefresh]);
}
