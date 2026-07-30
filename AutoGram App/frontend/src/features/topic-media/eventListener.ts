import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ThumbnailBatchEvent, TopicMediaDeltaEvent } from './types';

export const EVENT_DELTA = 'topic-media://delta';
export const EVENT_THUMBNAIL_BATCH = 'topic-media://thumbnail-batch';

export async function listenTopicMediaDelta(
  onDelta: (event: TopicMediaDeltaEvent) => void,
): Promise<UnlistenFn> {
  return await listen<TopicMediaDeltaEvent>(EVENT_DELTA, (e) => {
    if (e.payload) {
      onDelta(e.payload);
    }
  });
}

export async function listenThumbnailBatch(
  onBatch: (event: ThumbnailBatchEvent) => void,
): Promise<UnlistenFn> {
  return await listen<ThumbnailBatchEvent>(EVENT_THUMBNAIL_BATCH, (e) => {
    if (e.payload) {
      onBatch(e.payload);
    }
  });
}
