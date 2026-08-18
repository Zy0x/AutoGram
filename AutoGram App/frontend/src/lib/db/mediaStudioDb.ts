import type { DriveFile, DriveMediaContext, MediaScopeKind } from '../telegram/driveTypes';

export interface MediaRecord extends DriveFile {
  folderId: number;      // composite folder/chat id
  lastAccessed: number;
  accessCount: number;
  accountId: string;
  peerId: string;
  scopeKind: MediaScopeKind;
  topicIdNormalized: number;
}

export interface ThumbnailCacheRecord {
  key: string; // accountId:peerId:scopeKind:topicId:messageId:quality
  accountId: string;
  peerId: string;
  scopeKind: MediaScopeKind;
  topicId: number | null;
  messageId: number;
  quality: 'saver' | 'balanced' | 'sharp';
  sourceFingerprint: string;
  localPath?: string;
  blob?: Blob;
  updatedAt: number;
  lastAccessedAt: number;
}

export interface ThumbnailRecord {
  folderId: number;
  messageId: number;
  blob: Blob;
  width: number;
  height: number;
  timestamp: number;
}

export interface CheckpointRecord {
  jobId: string;
  session?: string;
  folderId: number;
  sortMode: string;
  lastOffsetId: number;
  lastSortValue?: number;
  processedCount: number;
  totalCount: number;
  status: 'running' | 'completed' | 'failed';
  timestamp: string;
  version: number;
}

export interface ActionJob {
  id: string;              // "act_" + timestamp + random
  session?: string;
  type: 'delete' | 'rename' | 'move' | 'download';
  target: {
    messageId: number;
    chatId: number;
  };
  payload: {
    newName?: string;
    destinationFolderId?: number;
  };
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  retryCount: number;
  error: string | null;
}

export interface SyncState {
  chatId: number;
  pts: number;
  date: number;
  lastSync: number;
}

export interface DeepIndexRecord {
  key: string; // session:peerId:topicId
  session: string;
  peerId: string;
  topicId: number | null;
  files: DriveFile[];
  hasMore: boolean;
  nextOffsetId: number | null;
  totalCount: number | null;
  totalBytes: number | null;
  scannedAt: number;
}

const DB_NAME = 'autogram-media-studio-v4';
const DB_VERSION = 6;

let dbPromise: Promise<IDBDatabase> | null = null;

export function normalizeTopicId(
  scopeKind: MediaScopeKind,
  topicId: number | null | undefined
): number {
  if (scopeKind === 'all') return -1;
  return topicId ?? 0;
}

export function buildDriveMediaContext(
  accountId: string,
  peerId: number | string | null,
  topicId: number | null | undefined
): DriveMediaContext {
  const scopeKind: MediaScopeKind = topicId == null ? 'all' : topicId === 0 ? 'general' : 'topic';
  return {
    accountId: String(accountId || '').trim(),
    peerId: peerId == null ? 'me' : String(peerId),
    scopeKind,
    topicId: topicId ?? null,
  };
}

function createMediaStore(db: IDBDatabase): IDBObjectStore {
  const store = db.createObjectStore('media', {
    keyPath: ['accountId', 'peerId', 'scopeKind', 'topicIdNormalized', 'id'],
  });
  store.createIndex(
    'byContextDate',
    ['accountId', 'peerId', 'scopeKind', 'topicIdNormalized', 'created_at'],
    { unique: false }
  );
  store.createIndex(
    'byContextSize',
    ['accountId', 'peerId', 'scopeKind', 'topicIdNormalized', 'size'],
    { unique: false }
  );
  store.createIndex(
    'byContextName',
    ['accountId', 'peerId', 'scopeKind', 'topicIdNormalized', 'name'],
    { unique: false }
  );
  store.createIndex(
    'byContextAccess',
    ['accountId', 'peerId', 'scopeKind', 'topicIdNormalized', 'lastAccessed'],
    { unique: false }
  );
  store.createIndex(
    'byContextMessage',
    ['accountId', 'peerId', 'scopeKind', 'topicIdNormalized', 'id'],
    { unique: true }
  );
  return store;
}

export function initDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;

      // v4 used [folderId, messageId] as the primary key. Saved Messages used
      // folderId=0 for every account, so records could overwrite each other.
      // Media metadata is only an acceleration cache: discard the unsafe store
      // once and rebuild it with a fully account/peer/topic-scoped key.
      if (oldVersion < 5 && db.objectStoreNames.contains('media')) {
        db.deleteObjectStore('media');
      }
      if (!db.objectStoreNames.contains('media')) createMediaStore(db);

      // 2. Thumbnails store
      if (!db.objectStoreNames.contains('thumbnails')) {
        db.createObjectStore('thumbnails', { keyPath: ['folderId', 'messageId'] });
      }

      if (!db.objectStoreNames.contains('thumbnailsV2')) {
        db.createObjectStore('thumbnailsV2', { keyPath: 'key' });
      }

      // 3. Checkpoints store
      if (!db.objectStoreNames.contains('checkpoints')) {
        db.createObjectStore('checkpoints', { keyPath: 'jobId' });
      }

      // 4. Action Queue store
      if (!db.objectStoreNames.contains('actionQueue')) {
        const actionStore = db.createObjectStore('actionQueue', { keyPath: 'id' });
        actionStore.createIndex('byStatus', 'status', { unique: false });
        actionStore.createIndex('byCreated', 'createdAt', { unique: false });
      }

      // 5. Sync State store
      if (!db.objectStoreNames.contains('syncState')) {
        db.createObjectStore('syncState', { keyPath: 'chatId' });
      }

      // 6. Persistent Location Deep Index store
      if (!db.objectStoreNames.contains('deepIndex')) {
        db.createObjectStore('deepIndex', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open database'));
  });

  return dbPromise;
}

export async function getMediaPageByContext(
  context: DriveMediaContext,
  sortMode: string,
  offset: number,
  limit: number
): Promise<MediaRecord[]> {
  const db = await initDb();
  return new Promise<MediaRecord[]>((resolve, reject) => {
    const tx = db.transaction('media', 'readonly');
    const store = tx.objectStore('media');
    const normTopic = normalizeTopicId(context.scopeKind, context.topicId);

    if (!store.indexNames.contains('byContextDate')) {
      resolve([]);
      return;
    }

    let indexName = 'byContextDate';
    let direction: IDBCursorDirection = 'prev';
    switch (sortMode) {
      case 'oldest':
      case 'oldest_first':
        direction = 'next';
        break;
      case 'size_desc':
        indexName = 'byContextSize';
        break;
      case 'size_asc':
        indexName = 'byContextSize';
        direction = 'next';
        break;
      case 'name_desc':
        indexName = 'byContextName';
        break;
      case 'name_asc':
        indexName = 'byContextName';
        direction = 'next';
        break;
    }

    const index = store.index(indexName);
    const isNumeric = indexName === 'byContextSize';
    const minKey = [context.accountId, context.peerId, context.scopeKind, normTopic, isNumeric ? 0 : ''];
    const maxKey = [context.accountId, context.peerId, context.scopeKind, normTopic, isNumeric ? Number.MAX_SAFE_INTEGER : '\uffff'];
    const range = IDBKeyRange.bound(minKey, maxKey);

    const results: MediaRecord[] = [];
    let advanced = false;

    const request = index.openCursor(range, direction);
    request.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) {
        resolve(results);
        return;
      }

      if (offset > 0 && !advanced) {
        advanced = true;
        cursor.advance(offset);
        return;
      }

      results.push(cursor.value);
      if (results.length < limit) {
        cursor.continue();
      } else {
        resolve(results);
      }
    };

    request.onerror = () => reject(request.error || new Error('getMediaPageByContext query failed'));
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Request failed'));
  });
}

// ── MEDIA RECORDS API ──

export async function saveMediaRecords(records: Omit<MediaRecord, 'lastAccessed' | 'accessCount'>[]): Promise<void> {
  const db = await initDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    const now = Date.now();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));

    for (const rec of records) {
      if (!rec.accountId || !rec.peerId || !rec.scopeKind) continue;
      const fullRecord: MediaRecord = {
        ...rec,
        // Preserve the display name. IndexedDB ordering remains deterministic,
        // while the explorer applies locale-aware case-insensitive sorting.
        name: (rec.name || '').trim(),
        lastAccessed: now,
        accessCount: 1,
      };
      store.put(fullRecord);
    }
  });
}

export function scopeMediaRecords(
  records: DriveFile[],
  context: DriveMediaContext,
  folderId: number
): Omit<MediaRecord, 'lastAccessed' | 'accessCount'>[] {
  const topicIdNormalized = normalizeTopicId(context.scopeKind, context.topicId);
  return records.map((record) => ({
    ...record,
    folderId,
    accountId: context.accountId,
    peerId: context.peerId,
    scopeKind: context.scopeKind,
    topicIdNormalized,
  }));
}

export async function deleteMediaRecordByContext(
  context: DriveMediaContext,
  id: number
): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('media', 'readwrite');
  await requestToPromise(tx.objectStore('media').delete([
    context.accountId,
    context.peerId,
    context.scopeKind,
    normalizeTopicId(context.scopeKind, context.topicId),
    id,
  ]));
}

export async function deleteMediaRecordsBatchByContext(
  context: DriveMediaContext,
  ids: number[]
): Promise<void> {
  if (!ids?.length) return;
  const db = await initDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    const topic = normalizeTopicId(context.scopeKind, context.topicId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete scoped media records'));
    for (const id of ids) {
      store.delete([context.accountId, context.peerId, context.scopeKind, topic, id]);
    }
  });
}

export async function deleteMediaRecordsForPeer(
  accountId: string,
  peerId: string,
  ids: number[]
): Promise<void> {
  if (!ids?.length) return;
  const idSet = new Set(ids.map(Number));
  const db = await initDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete peer media records'));
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as MediaRecord;
      if (record.accountId === accountId && record.peerId === peerId && idSet.has(Number(record.id))) {
        cursor.delete();
      }
      cursor.continue();
    };
  });
}

export async function clearMediaCache(): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('media', 'readwrite');
  await requestToPromise(tx.objectStore('media').clear());
}

export async function deleteMediaRecordsBySession(session: string): Promise<void> {
  if (!session) return;
  const s = String(session).trim();
  const db = await initDb();

  // 1. Delete from media store
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete session media records'));
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as MediaRecord;
      if (record.accountId === s) {
        cursor.delete();
      }
      cursor.continue();
    };
  });

  // 2. Delete from deepIndex store
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('deepIndex', 'readwrite');
    const store = tx.objectStore('deepIndex');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete session deep index'));
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as DeepIndexRecord;
      if (record.session === s || record.key?.startsWith(`${s}:`)) {
        cursor.delete();
      }
      cursor.continue();
    };
  });
}

// ── LRU EVICTION ──

// ── THUMBNAILS API ──

export async function saveThumbnail(folderId: number, messageId: number, blob: Blob, width: number, height: number): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('thumbnails', 'readwrite');
  const record: ThumbnailRecord = {
    folderId,
    messageId,
    blob,
    width,
    height,
    timestamp: Date.now(),
  };
  await requestToPromise(tx.objectStore('thumbnails').put(record));
}

export async function getThumbnail(folderId: number, messageId: number): Promise<ThumbnailRecord | null> {
  const db = await initDb();
  const tx = db.transaction('thumbnails', 'readonly');
  try {
    const rec = await requestToPromise(tx.objectStore('thumbnails').get([folderId, messageId]));
    return (rec as ThumbnailRecord) || null;
  } catch {
    return null;
  }
}

// ── CHECKPOINTS API ──

export async function saveCheckpoint(cp: CheckpointRecord): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('checkpoints', 'readwrite');
  await requestToPromise(tx.objectStore('checkpoints').put(cp));
}

export async function getCheckpoint(jobId: string): Promise<CheckpointRecord | null> {
  const db = await initDb();
  const tx = db.transaction('checkpoints', 'readonly');
  try {
    const rec = await requestToPromise(tx.objectStore('checkpoints').get(jobId));
    return (rec as CheckpointRecord) || null;
  } catch {
    return null;
  }
}

// ── ACTION QUEUE API ──

export async function enqueueAction(job: Omit<ActionJob, 'status' | 'createdAt' | 'retryCount' | 'error'>): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('actionQueue', 'readwrite');
  const fullJob: ActionJob = {
    ...job,
    status: 'pending',
    createdAt: Date.now(),
    retryCount: 0,
    error: null,
  };
  await requestToPromise(tx.objectStore('actionQueue').put(fullJob));
}

export async function getPendingActions(): Promise<ActionJob[]> {
  const db = await initDb();
  return new Promise<ActionJob[]>((resolve, reject) => {
    const tx = db.transaction('actionQueue', 'readonly');
    const index = tx.objectStore('actionQueue').index('byStatus');
    const range = IDBKeyRange.only('pending');
    const results: ActionJob[] = [];

    index.openCursor(range).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    index.openCursor(range).onerror = () => reject(new Error('Failed to get pending actions'));
  });
}

export async function updateActionStatus(id: string, status: ActionJob['status'], error: string | null = null): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('actionQueue', 'readwrite');
  const store = tx.objectStore('actionQueue');
  const job = (await requestToPromise(store.get(id))) as ActionJob | null;
  if (job) {
    job.status = status;
    job.error = error;
    if (status === 'failed') {
      job.retryCount += 1;
    }
    await requestToPromise(store.put(job));
  }
}

export async function deleteAction(id: string): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('actionQueue', 'readwrite');
  await requestToPromise(tx.objectStore('actionQueue').delete(id));
}

// ── SYNC STATE API ──

export async function saveSyncState(state: SyncState): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('syncState', 'readwrite');
  await requestToPromise(tx.objectStore('syncState').put(state));
}

export async function getSyncState(chatId: number): Promise<SyncState | null> {
  const db = await initDb();
  const tx = db.transaction('syncState', 'readonly');
  try {
    const rec = await requestToPromise(tx.objectStore('syncState').get(chatId));
    return (rec as SyncState) || null;
  } catch {
    return null;
  }
}

export async function getMediaStudioCacheSize(): Promise<number> {
  try {
    const db = await initDb();
    let total = 0;
    const storeNames = Array.from(db.objectStoreNames);
    if (storeNames.length === 0) return 0;

    const tx = db.transaction(storeNames, 'readonly');
    for (const name of storeNames) {
      const store = tx.objectStore(name);
      await new Promise<void>((resolve) => {
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor) {
            try {
              const str = JSON.stringify(cursor.value);
              total += str ? str.length * 2 : 0;
            } catch {}
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => resolve();
      });
    }
    return total;
  } catch {
    return 0;
  }
}

export async function saveDeepIndexRecord(record: DeepIndexRecord): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('deepIndex', 'readwrite');
  await requestToPromise(tx.objectStore('deepIndex').put(record));
}

export async function getDeepIndexRecord(key: string): Promise<DeepIndexRecord | null> {
  const db = await initDb();
  const tx = db.transaction('deepIndex', 'readonly');
  try {
    const rec = await requestToPromise(tx.objectStore('deepIndex').get(key));
    return (rec as DeepIndexRecord) || null;
  } catch {
    return null;
  }
}

export async function deleteDeepIndexRecord(key: string): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('deepIndex', 'readwrite');
  await requestToPromise(tx.objectStore('deepIndex').delete(key));
}

export async function clearMediaStudioCache(): Promise<void> {
  try {
    const db = await initDb();
    const storeNames = Array.from(db.objectStoreNames);
    if (storeNames.length === 0) return;
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      try {
        tx.objectStore(name).clear();
      } catch {}
    }
  } catch {}
}
