import { useCallback, useEffect, useState } from 'react';
import { loadMoreTopicMedia, openTopicMedia } from './api';
import { topicMediaStore, type TopicMediaViewState } from './store';
import type { TopicMediaContext } from './types';
import { useTopicMediaEvents } from './useTopicMediaEvents';

export function useTopicMedia(
  context: TopicMediaContext | null,
  session?: string,
  apiId?: number,
  apiHash?: string,
  windowLabel = 'main',
) {
  useTopicMediaEvents();

  const [state, setState] = useState<TopicMediaViewState | null>(() =>
    topicMediaStore.getActiveViewState(),
  );

  useEffect(() => {
    const unsub = topicMediaStore.subscribe(() => {
      setState(topicMediaStore.getActiveViewState());
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!context || !session || !apiId || !apiHash) return;

    const genId = topicMediaStore.openTopic(context);

    openTopicMedia(windowLabel, session, apiId, apiHash, context)
      .then((res) => {
        topicMediaStore.setInitialItems(
          context,
          genId,
          res.items,
          res.cursor,
          res.hasMoreLocal,
        );
      })
      .catch((err) => {
        console.error('[TopicMedia] Failed to open topic:', err);
      });
  }, [context?.accountId, context?.peerId, context?.topicId, session, apiId, apiHash, windowLabel]);

  const loadMore = useCallback(async () => {
    if (!context || !state || !state.hasMore || state.status === 'loading-cache') return;
    try {
      const moreItems = await loadMoreTopicMedia(context, state.cursor);
      if (moreItems.length > 0) {
        const last = moreItems[moreItems.length - 1];
        topicMediaStore.applyDelta(
          context,
          state.generationId,
          moreItems,
          [],
          [],
          { messageDate: last.messageDate, messageId: last.messageId },
          moreItems.length >= 40,
        );
      }
    } catch (e) {
      console.error('[TopicMedia] Failed loadMore:', e);
    }
  }, [context, state]);

  return {
    items: state?.items || [],
    status: state?.status || 'idle',
    hasMore: state?.hasMore || false,
    loadMore,
  };
}
