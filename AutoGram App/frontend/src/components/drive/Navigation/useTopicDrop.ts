import { useState, useCallback } from 'react';
import { getActiveDriveDrag, getDriveDragData } from '../../../lib/telegram';

export interface UseTopicDropOpts {
  onDropOnTopic?: (topicId: number | null, topicTitle: string, e: React.DragEvent) => void;
}

export function useTopicDrop({ onDropOnTopic }: UseTopicDropOpts = {}) {
  const [activeDragTopicId, setActiveDragTopicId] = useState<number | 'all' | null>(null);

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
    setActiveDragTopicId((prev) => (prev === targetKey ? prev : targetKey));
  }, []);

  const handleDragLeave = useCallback((topicId: number | null, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const targetKey = topicId == null ? 'all' : topicId;
    setActiveDragTopicId((prev) => (prev === targetKey ? null : prev));
  }, []);

  const handleDrop = useCallback(
    (topicId: number | null, topicTitle: string, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setActiveDragTopicId(null);

      // Extract dragged item message IDs from memory or DataTransfer payload
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
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
