import type { TopicMediaContext } from './types';

export function topicMediaKey(accountId: string, peerId: string, topicId: number): string {
  return `${accountId}:${peerId}:${topicId}`;
}

export function contextToKey(ctx: TopicMediaContext): string {
  return topicMediaKey(ctx.accountId, ctx.peerId, ctx.topicId);
}

export function isSameContext(a?: TopicMediaContext | null, b?: TopicMediaContext | null): boolean {
  if (!a || !b) return false;
  return a.accountId === b.accountId && a.peerId === b.peerId && a.topicId === b.topicId;
}
