export interface ClientCacheClearSummary {
  removedEntries: number;
  freedBytes: number;
}

const LOCAL_CACHE_PREFIXES = [
  'autogram_drive_locations_v1_',
  'autogram_drive_sidebar_v1_',
  'autogram_drive_topics_v1_',
  'autogram_drive_peer_v2_',
  'autogram_drive_scroll_v1_',
  'autogram_drive_recents_v2_',
  'autogram_chat_folder_',
];

const LOCAL_CACHE_KEYS = new Set([
  'autogram_drive_peer',
  'autogram_drive_recents',
  'autogram_drive_sessions_cache',
]);

const SESSION_CACHE_PREFIXES = ['drive_root_chats_', 'drive_root_files_'];

export function isClientCacheKey(key: string, storage: 'local' | 'session'): boolean {
  if (storage === 'session') {
    return SESSION_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
  }
  return LOCAL_CACHE_KEYS.has(key) || LOCAL_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function clearMatching(storage: Storage, kind: 'local' | 'session'): ClientCacheClearSummary {
  const keys: string[] = [];
  let freedBytes = 0;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !isClientCacheKey(key, kind)) continue;
    const value = storage.getItem(key) || '';
    freedBytes += (key.length + value.length) * 2;
    keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
  return { removedEntries: keys.length, freedBytes };
}

/** Clear only rebuildable browser caches; sessions, pins and preferences survive. */
export function clearClientCacheStorage(): ClientCacheClearSummary {
  const local = clearMatching(localStorage, 'local');
  const session = clearMatching(sessionStorage, 'session');
  return {
    removedEntries: local.removedEntries + session.removedEntries,
    freedBytes: local.freedBytes + session.freedBytes,
  };
}

export function getClientCacheStorageSize(): number {
  let bytes = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !isClientCacheKey(key, 'local')) continue;
    bytes += (key.length + (localStorage.getItem(key) || '').length) * 2;
  }
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index);
    if (!key || !isClientCacheKey(key, 'session')) continue;
    bytes += (key.length + (sessionStorage.getItem(key) || '').length) * 2;
  }
  return bytes;
}
