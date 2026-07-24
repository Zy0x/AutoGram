import type { DriveFile } from './driveTypes';

export interface MediaRecord extends DriveFile {
  folderId: number;      // composite folder/chat id
  lastAccessed: number;
  accessCount: number;
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

const DB_NAME = 'autogram-media-studio-v2';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function initDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      // 1. Media store with composite keys and indices
      if (!db.objectStoreNames.contains('media')) {
        const mediaStore = db.createObjectStore('media', { keyPath: ['folderId', 'id'] });
        mediaStore.createIndex('byFolder', 'folderId', { unique: false });
        mediaStore.createIndex('byFolder_Date', ['folderId', 'created_at'], { unique: false });
        mediaStore.createIndex('byFolder_Size', ['folderId', 'size'], { unique: false });
        mediaStore.createIndex('byFolder_Name', ['folderId', 'name'], { unique: false });
        mediaStore.createIndex('byFolder_Access', ['folderId', 'lastAccessed'], { unique: false });
      }

      // 2. Thumbnails store
      if (!db.objectStoreNames.contains('thumbnails')) {
        db.createObjectStore('thumbnails', { keyPath: ['folderId', 'messageId'] });
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
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open database'));
  });

  return dbPromise;
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
      const fullRecord: MediaRecord = {
        ...rec,
        name: (rec.name || '').trim().toLowerCase(),
        lastAccessed: now,
        accessCount: 1,
      };
      store.put(fullRecord);
    }
  });
}

export async function deleteMediaRecord(folderId: number, id: number): Promise<void> {
  const db = await initDb();
  const tx = db.transaction('media', 'readwrite');
  await requestToPromise(tx.objectStore('media').delete([folderId, id]));
}

export async function deleteMediaRecordsBatch(folderId: number, ids: number[]): Promise<void> {
  if (!ids || !ids.length) return;
  const db = await initDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to delete media records batch'));
    for (const id of ids) {
      store.delete([folderId, id]);
    }
  });
}

export async function clearFolderMedia(folderId: number): Promise<void> {
  const db = await initDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    const index = store.index('byFolder');
    const keyRange = IDBKeyRange.only(folderId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to clear folder media'));

    index.openCursor(keyRange).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  });
}

export async function getFolderMediaCount(folderId: number): Promise<number> {
  const db = await initDb();
  const tx = db.transaction('media', 'readonly');
  const store = tx.objectStore('media');
  const index = store.index('byFolder');
  return requestToPromise(index.count(IDBKeyRange.only(folderId)));
}

export async function getMediaRecords(
  folderId: number,
  sortMode: string,
  offset: number,
  limit: number
): Promise<MediaRecord[]> {
  const db = await initDb();
  return new Promise<MediaRecord[]>((resolve, reject) => {
    const tx = db.transaction('media', 'readonly');
    const store = tx.objectStore('media');

    let indexName = 'byFolder_Date';
    let direction: IDBCursorDirection = 'prev'; // default newest first

    switch (sortMode) {
      case 'oldest':
      case 'oldest_first':
        indexName = 'byFolder_Date';
        direction = 'next';
        break;
      case 'newest':
      case 'newest_first':
        indexName = 'byFolder_Date';
        direction = 'prev';
        break;
      case 'size_desc':
        indexName = 'byFolder_Size';
        direction = 'prev';
        break;
      case 'size_asc':
        indexName = 'byFolder_Size';
        direction = 'next';
        break;
      case 'name_desc':
        indexName = 'byFolder_Name';
        direction = 'prev';
        break;
      case 'name_asc':
        indexName = 'byFolder_Name';
        direction = 'next';
        break;
      default:
        indexName = 'byFolder_Date';
        direction = 'prev';
    }

    const index = store.index(indexName);
    let range: IDBKeyRange;
    if (indexName === 'byFolder_Size') {
      range = IDBKeyRange.bound([folderId, -Infinity], [folderId, Infinity]);
    } else {
      range = IDBKeyRange.bound([folderId, ''], [folderId, '\uffff']);
    }

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

    request.onerror = () => reject(request.error || new Error('Query failed'));
  });
}

// ── LRU EVICTION ──

export async function pruneFolderMedia(folderId: number, maxEntries = 5000): Promise<number> {
  const count = await getFolderMediaCount(folderId);
  if (count <= maxEntries) return 0;

  const db = await initDb();
  const toEvict = count - maxEntries;
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    const index = store.index('byFolder_Access'); // evict least recently accessed first
    const range = IDBKeyRange.bound([folderId, -Infinity], [folderId, Infinity]);
    let evictedCount = 0;

    tx.oncomplete = () => resolve(evictedCount);
    tx.onerror = () => reject(tx.error || new Error('LRU pruning transaction failed'));

    index.openCursor(range, 'next').onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor && evictedCount < toEvict) {
        cursor.delete();
        evictedCount++;
        cursor.continue();
      }
    };
  });
}

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
