import { invoke } from '@tauri-apps/api/core';
import type { OpenTopicMediaResult, TopicMediaContext, TopicMediaCursor, TopicMediaItem } from './types';

export interface OpResult<T> {
  ok: boolean;
  backend: string;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export async function openTopicMedia(
  windowLabel: string,
  session: string,
  apiId: number,
  apiHash: string,
  context: TopicMediaContext,
  filterTypes?: string[],
  pageSize?: number,
): Promise<OpenTopicMediaResult> {
  const res = await invoke<OpResult<OpenTopicMediaResult>>('tg_open_topic_media', {
    payload: {
      windowLabel,
      session,
      apiId,
      apiHash,
      accountId: context.accountId,
      peerId: context.peerId,
      topicId: context.topicId,
      filterTypes,
      pageSize,
    },
  });

  if (!res.ok || !res.data) {
    throw new Error(res.error?.message || 'Failed to open topic media');
  }

  return res.data;
}

export async function loadMoreTopicMedia(
  context: TopicMediaContext,
  cursor?: TopicMediaCursor | null,
  pageSize?: number,
): Promise<TopicMediaItem[]> {
  const res = await invoke<OpResult<TopicMediaItem[]>>('tg_load_more_topic_media', {
    accountId: context.accountId,
    peerId: context.peerId,
    topicId: context.topicId,
    cursor,
    pageSize,
  });

  if (!res.ok || !res.data) {
    throw new Error(res.error?.message || 'Failed to load more topic media');
  }

  return res.data;
}
