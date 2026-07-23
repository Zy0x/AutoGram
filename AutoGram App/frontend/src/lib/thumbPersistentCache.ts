const DB_NAME = 'autogram-drive-thumbs-v1';
const STORE_NAME = 'thumbs';
const MAX_ENTRIES = 5000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_DATA_URL_CHARS = 512 * 1024;

type ThumbRow = { key: string; dataUrl: string; savedAt: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;
let savesSincePrune = 0;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('savedAt', 'savedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function requestResult<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function loadPersistentThumb(key: string, now = Date.now()): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const row = await requestResult(tx.objectStore(STORE_NAME).get(key)) as ThumbRow | null;
    if (!row || typeof row.dataUrl !== 'string') return null;
    if (!Number.isFinite(row.savedAt) || now - row.savedAt > MAX_AGE_MS) {
      try {
        db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key);
      } catch {
        /* ignore stale cleanup */
      }
      return null;
    }
    return row.dataUrl;
  } catch {
    return null;
  }
}

/** Read a visible batch in one IndexedDB transaction instead of one transaction per card. */
export async function loadPersistentThumbs(
  keys: string[],
  now = Date.now()
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return out;
  const db = await openDb();
  if (!db) return out;
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    await Promise.all(
      unique.map(async (key) => {
        const row = (await requestResult(store.get(key))) as ThumbRow | null;
        if (!row || typeof row.dataUrl !== 'string') return;
        if (!Number.isFinite(row.savedAt) || now - row.savedAt > MAX_AGE_MS) return;
        out.set(key, row.dataUrl);
      })
    );
  } catch {
    return out;
  }
  return out;
}

/** Used by cold-cache QA and Settings cache reset; never touches Telegram sessions. */
export async function clearPersistentThumbs(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
  } catch {
    /* cache reset is best-effort */
  }
}

async function prunePersistentThumbs(db: IDBDatabase): Promise<void> {
  try {
    const countTx = db.transaction(STORE_NAME, 'readonly');
    const count = await requestResult(countTx.objectStore(STORE_NAME).count());
    const overflow = Math.max(0, Number(count || 0) - MAX_ENTRIES);
    if (!overflow) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const index = tx.objectStore(STORE_NAME).index('savedAt');
    let removed = 0;
    index.openCursor().onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor || removed >= overflow) return;
      cursor.delete();
      removed += 1;
      cursor.continue();
    };
  } catch {
    /* cache pruning is best-effort */
  }
}

export async function savePersistentThumb(key: string, dataUrl: string): Promise<void> {
  if (!dataUrl || dataUrl.length > MAX_DATA_URL_CHARS) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key, dataUrl, savedAt: Date.now() } satisfies ThumbRow);
    savesSincePrune += 1;
    if (savesSincePrune >= 24) {
      savesSincePrune = 0;
      void prunePersistentThumbs(db);
    }
  } catch {
    /* thumbnail cache must never block rendering */
  }
}


export async function getPersistentThumbsSize(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result as ThumbRow[];
        let total = 0;
        for (const item of items) {
          total += (item.key.length + item.dataUrl.length + 8);
        }
        resolve(total);
      };
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

export async function prunePersistentThumbsToSize(targetBytes: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const items = await new Promise<ThumbRow[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as ThumbRow[]) || []);
      req.onerror = () => resolve([]);
    });

    let currentSize = items.reduce((acc, item) => acc + item.key.length + item.dataUrl.length + 8, 0);
    if (currentSize <= targetBytes) return;

    // Sort items by savedAt ascending (oldest first)
    items.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));

    for (const item of items) {
      if (currentSize <= targetBytes) break;
      const itemSize = item.key.length + item.dataUrl.length + 8;
      store.delete(item.key);
      currentSize -= itemSize;
    }
  } catch {
    /* best-effort pruning */
  }
}
