export interface TopicMediaContext {
  accountId: string;
  peerId: string;
  topicId: number;
}

export interface TopicMediaCursor {
  messageDate: number;
  messageId: number;
}

export interface TopicMediaItem {
  accountId: string;
  peerId: string;
  topicId: number;
  messageId: number;
  messageDate: number;
  editDate?: number | null;
  groupedId?: number | null;
  senderId?: string | null;
  caption?: string | null;
  mediaType: 'photo' | 'video' | 'document' | 'audio' | 'url';
  mimeType?: string | null;
  fileName: string;
  fileSize: number;
  documentId?: number | null;
  accessHash?: number | null;
  dcId?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  hasServerThumb: boolean;
  hasVideoThumb: boolean;
  thumbUrl?: string | null;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ThumbnailMode = 'saver' | 'balance' | 'high';

export interface OpenTopicMediaRequest {
  windowLabel: string;
  generationId: number;
  context: TopicMediaContext;
  filterTypes: string[];
  pageSize: number;
}

export interface OpenTopicMediaResult {
  context: TopicMediaContext;
  generationId: number;
  source: 'cache' | 'empty';
  items: TopicMediaItem[];
  cursor: TopicMediaCursor | null;
  hasMoreLocal: boolean;
  reconciliationScheduled: boolean;
}

export interface TopicMediaDeltaEvent {
  schemaVersion: number;
  windowLabel: string;
  accountId: string;
  peerId: string;
  topicId: number;
  generationId: number;
  inserted: TopicMediaItem[];
  updated: TopicMediaItem[];
  deletedMessageIds: number[];
  cursor: TopicMediaCursor | null;
  hasMore: boolean;
  syncStatus: 'syncing' | 'ready' | 'paused' | 'error';
}

export interface ThumbnailBatchCompletedItem {
  messageId: number;
  variant: ThumbnailMode;
  source: string;
  localUrl: string;
  width: number;
  height: number;
}

export interface ThumbnailBatchFailedItem {
  messageId: number;
  code: string;
  retryable: boolean;
}

export interface ThumbnailBatchEvent {
  schemaVersion: number;
  accountId: string;
  peerId: string;
  topicId: number;
  completed: ThumbnailBatchCompletedItem[];
  failed: ThumbnailBatchFailedItem[];
}
