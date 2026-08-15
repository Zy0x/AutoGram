import type { DriveFile } from '../driveTypes';
import { invoke } from '@tauri-apps/api/core';
import {
  getDeepIndexRecord,
  saveDeepIndexRecord,
  deleteDeepIndexRecord,
  type DeepIndexRecord,
} from '../../db/mediaStudioDb';

export const DEEP_INDEX_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL

export type DeepIndexSnapshot = {
  files: DriveFile[];
  hasMore: boolean;
  nextOffsetId: number | null;
  totalCount: number | null;
  totalBytes: number | null;
  scannedAt: number;
};

export function deepIndexKey(
  session: string,
  peerId: number | null,
  topicId: number | null
): string {
  const s = String(session || '').trim();
  const p = peerId == null ? 'root' : peerId;
  const t = topicId == null ? 'all' : topicId;
  return `${s}:${p}:${t}`;
}

export async function loadDeepIndexSnapshot(
  session: string,
  peerId: number | null,
  topicId: number | null,
  now = Date.now()
): Promise<DeepIndexSnapshot | null> {
  if (!session) return null;
  const key = deepIndexKey(session, peerId, topicId);
  const rec = await getDeepIndexRecord(key);
  if (!rec || !Array.isArray(rec.files) || rec.files.length === 0) return null;

  if (now - (rec.scannedAt || 0) > DEEP_INDEX_CACHE_MAX_AGE_MS) {
    void deleteDeepIndexRecord(key).catch(() => {});
    return null;
  }

  // Deduplicate files by ID to prevent duplicates
  const seen = new Set<string>();
  const deduped: DriveFile[] = [];
  for (const f of rec.files) {
    const fileIdKey = f && f.id != null ? String(f.id) : null;
    if (fileIdKey != null && !seen.has(fileIdKey)) {
      seen.add(fileIdKey);
      deduped.push(f);
    }
  }

  return {
    files: deduped,
    hasMore: !!rec.hasMore,
    nextOffsetId: rec.nextOffsetId ?? null,
    totalCount: rec.totalCount ?? null,
    totalBytes: rec.totalBytes ?? null,
    scannedAt: rec.scannedAt || now,
  };
}

export async function saveDeepIndexSnapshot(
  session: string,
  peerId: number | null,
  topicId: number | null,
  snapshot: Omit<DeepIndexSnapshot, 'scannedAt'>,
  now = Date.now()
): Promise<void> {
  if (!session || !Array.isArray(snapshot.files)) return;
  const key = deepIndexKey(session, peerId, topicId);
  const record: DeepIndexRecord = {
    key,
    session: String(session).trim(),
    peerId: peerId == null ? 'root' : String(peerId),
    topicId,
    files: snapshot.files,
    hasMore: !!snapshot.hasMore,
    nextOffsetId: snapshot.nextOffsetId ?? null,
    totalCount: snapshot.totalCount ?? null,
    totalBytes: snapshot.totalBytes ?? null,
    scannedAt: now,
  };

  try {
    await saveDeepIndexRecord(record);
    if (!snapshot.hasMore && peerId != null) {
      const exactCount = snapshot.files.length;
      void invoke('tg_save_exact_media_statistics', {
        request: {
          session: String(session).trim(),
          chatId: String(peerId),
          topicId: topicId ?? null,
          exactTotal: exactCount,
          exactBytes: snapshot.totalBytes ?? null,
        },
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[DeepIndexCache] Failed to save snapshot to IndexedDB', err);
  }
}

export async function appendFilesToDeepIndex(
  session: string,
  peerId: number | null,
  topicId: number | null,
  newFiles: DriveFile[],
  hasMore: boolean,
  nextOffsetId: number | null,
  totalCount: number | null = null,
  totalBytes: number | null = null
): Promise<void> {
  if (!session || !newFiles.length) return;
  const existing = await loadDeepIndexSnapshot(session, peerId, topicId);
  const combined = existing ? [...existing.files, ...newFiles] : newFiles;

  const seen = new Set<string>();
  const deduped: DriveFile[] = [];
  for (const f of combined) {
    const k = f && f.id != null ? String(f.id) : null;
    if (k != null && !seen.has(k)) {
      seen.add(k);
      deduped.push(f);
    }
  }

  await saveDeepIndexSnapshot(session, peerId, topicId, {
    files: deduped,
    hasMore,
    nextOffsetId,
    totalCount: totalCount ?? (existing ? existing.totalCount : null),
    totalBytes: totalBytes ?? (existing ? existing.totalBytes : null),
  });
}

export async function removeFilesFromDeepIndex(
  session: string,
  peerId: number | null,
  topicId: number | null,
  deletedIds: number[]
): Promise<void> {
  if (!session || !deletedIds || !deletedIds.length) return;
  const existing = await loadDeepIndexSnapshot(session, peerId, topicId);
  if (!existing || !existing.files.length) return;

  const deletedSet = new Set(deletedIds.map((id) => Number(id)));
  const updatedFiles = existing.files.filter((f) => !deletedSet.has(Number(f.id)));

  if (updatedFiles.length === existing.files.length) return;

  const removedCount = existing.files.length - updatedFiles.length;
  await saveDeepIndexSnapshot(session, peerId, topicId, {
    files: updatedFiles,
    hasMore: existing.hasMore,
    nextOffsetId: existing.nextOffsetId,
    totalCount: existing.totalCount != null ? Math.max(0, existing.totalCount - removedCount) : null,
    totalBytes: existing.totalBytes,
  });
}
