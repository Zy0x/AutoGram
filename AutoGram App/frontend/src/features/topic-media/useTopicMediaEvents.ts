import { useEffect } from 'react';
import { listenTopicMediaDelta } from './eventListener';
import { topicMediaStore } from './store';

export function useTopicMediaEvents(): void {
  useEffect(() => {
    let unlistenDelta: (() => void) | undefined;

    listenTopicMediaDelta((payload) => {
      topicMediaStore.applyDelta(
        {
          accountId: payload.accountId,
          peerId: payload.peerId,
          topicId: payload.topicId,
        },
        payload.generationId,
        payload.inserted,
        payload.updated,
        payload.deletedMessageIds,
        payload.cursor,
        payload.hasMore,
      );
    }).then((un) => {
      unlistenDelta = un;
    });

    return () => {
      if (unlistenDelta) unlistenDelta();
    };
  }, []);
}
