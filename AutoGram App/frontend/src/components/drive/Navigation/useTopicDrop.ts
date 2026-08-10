import { useState, useCallback, useEffect } from 'react';
import {
  getActiveDriveDrag,
  getDriveDragData,
  getLastHoverDropKey,
  isPointerDriveDragActive,
  setLastHoverDropKey,
  subscribeDriveDragUi,
} from '../../../lib/telegram';

export interface UseTopicDropOpts {
  onDropOnTopic?: (topicId: number | null, topicTitle: string, e: React.DragEvent) => void;
}

export function useTopicDrop({ onDropOnTopic }: UseTopicDropOpts = {}) {
  const [activeDragTopicId, setActiveDragTopicId] = useState<number | 'all' | null>(null);
  const [pointerHoverKey, setPointerHoverKey] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeDriveDragUi(() => {
      const dragActive = isPointerDriveDragActive() || !!getActiveDriveDrag();
      const k = getLastHoverDropKey();
      if (!dragActive || !k) {
        setPointerHoverKey(null);
        setActiveDragTopicId(null);
        return;
      }
      setPointerHoverKey(k);
      if (k.startsWith('topic:')) {
        const idPart = k.slice('topic:'.length);
        if (idPart === 'all' || idPart === 'null') {
          setActiveDragTopicId('all');
        } else {
          const num = Number(idPart);
          if (Number.isFinite(num)) setActiveDragTopicId(num);
          else setActiveDragTopicId(null);
        }
      } else {
        setActiveDragTopicId(null);
      }
    });
    return unsub;
  }, []);

  const handleDragOver = useCallback((topicId: number | null, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    } catch {
      /* ignore */
    }
    const targetKey = topicId == null ? 'all' : topicId;
    setLastHoverDropKey(topicId == null ? 'topic:all' : `topic:${topicId}`);
    setActiveDragTopicId((prev) => (prev === targetKey ? prev : targetKey));
  }, []);

  const handleDragLeave = useCallback((topicId: number | null, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const targetKey = topicId == null ? 'all' : topicId;
    if (getLastHoverDropKey() === (topicId == null ? 'topic:all' : `topic:${topicId}`)) {
      setLastHoverDropKey(null);
    }
    setActiveDragTopicId((prev) => (prev === targetKey ? null : prev));
  }, []);

  const handleDrop = useCallback(
    (topicId: number | null, topicTitle: string, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setLastHoverDropKey(null);
      setActiveDragTopicId(null);

      // Pointer internal drag: SpeedTest pointerup in MediaStudio owns completion
      if (isPointerDriveDragActive()) return;

      const internal = getActiveDriveDrag() || getDriveDragData(e.dataTransfer);
      if (!internal || !internal.messageIds || !internal.messageIds.length) {
        return;
      }

      onDropOnTopic?.(topicId, topicTitle, e);
    },
    [onDropOnTopic]
  );

  return {
    activeDragTopicId,
    pointerHoverKey,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
