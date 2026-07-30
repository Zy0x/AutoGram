import { useCallback, useEffect, useState } from 'react';
import { topicMediaStore } from './store';
import type { ThumbnailMode } from './types';

export function useThumbnailMode(): [ThumbnailMode, (mode: ThumbnailMode) => void] {
  const [mode, setModeState] = useState<ThumbnailMode>(() => topicMediaStore.getThumbnailMode());

  useEffect(() => {
    const unsub = topicMediaStore.subscribe(() => {
      setModeState(topicMediaStore.getThumbnailMode());
    });
    return unsub;
  }, []);

  const setMode = useCallback((newMode: ThumbnailMode) => {
    topicMediaStore.setThumbnailMode(newMode);
  }, []);

  return [mode, setMode];
}
