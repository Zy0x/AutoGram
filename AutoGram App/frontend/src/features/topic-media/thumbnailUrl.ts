import type { TopicMediaItem } from './types';

export function resolveThumbnailUrl(item: TopicMediaItem): string | null {
  if (item.thumbUrl) {
    return item.thumbUrl;
  }
  return null;
}
