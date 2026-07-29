import type { DriveTopic } from './driveTypes';

const PREFIX = 'autogram_drive_topics_v1_';
export const DRIVE_TOPICS_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type DriveTopicsSnapshot = {
  topics: DriveTopic[];
  is_forum: boolean;
  savedAt: number;
};

function key(session: string, chatId: number): string {
  return `${PREFIX}${encodeURIComponent(session)}_${chatId}`;
}

export function loadDriveTopicsSnapshot(
  storage: StorageLike,
  session: string,
  chatId: number,
  now = Date.now()
): DriveTopicsSnapshot | null {
  try {
    const parsed = JSON.parse(storage.getItem(key(session, chatId)) || 'null');
    if (!parsed || !Array.isArray(parsed.topics) || !Number.isFinite(parsed.savedAt)) return null;
    if (now - parsed.savedAt > DRIVE_TOPICS_CACHE_MAX_AGE_MS) return null;
    const topics = parsed.topics
      .filter((topic: any) => Number.isFinite(Number(topic?.id)) && Number(topic.id) > 0)
      .slice(0, 500)
      .map((topic: any) => ({
        id: Number(topic.id),
        title: String(topic.title || `Topic ${topic.id}`),
        top_message: topic.top_message == null ? null : Number(topic.top_message),
        closed: !!topic.closed,
      }));
    return {
      topics,
      is_forum: !!parsed.is_forum || topics.length > 0,
      savedAt: Number(parsed.savedAt),
    };
  } catch {
    return null;
  }
}

export function saveDriveTopicsSnapshot(
  storage: StorageLike,
  session: string,
  chatId: number,
  topics: DriveTopic[],
  isForum: boolean,
  now = Date.now()
): void {
  try {
    storage.setItem(
      key(session, chatId),
      JSON.stringify({
        topics: topics.slice(0, 500),
        is_forum: isForum,
        savedAt: now,
      })
    );
  } catch {
    // Acceleration only; Telegram remains the source of truth.
  }
}
