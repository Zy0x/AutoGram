import { topicMediaStore } from './store';
import type { TopicMediaItem } from './types';

export function selectActiveTopicItems(): TopicMediaItem[] {
  const state = topicMediaStore.getActiveViewState();
  return state ? state.items : [];
}

export function selectIsLoading(): boolean {
  const state = topicMediaStore.getActiveViewState();
  return state ? state.status === 'loading-cache' || state.status === 'syncing' : false;
}
