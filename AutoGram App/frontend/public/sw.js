const CACHE_NAME = 'autogram-media-v2';
const CHUNK_SIZE = 512 * 1024; // Harus match dengan backend _PART

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (!url.pathname.includes('/stream/')) return;

    event.respondWith(handleMediaRequest(event.request));
});

async function handleMediaRequest(request) {
    const cache = await caches.open(CACHE_NAME);
    const rangeHeader = request.headers.get('range') || 'bytes=0-';

    const chunkKey = `${request.url}#${rangeHeader}`;

    // 1. Cek cache dulu
    const cached = await cache.match(chunkKey);
    if (cached) {
        return cached; // HIT: Serve dari CacheStorage
    }

    // 2. MISS: Fetch dari Python proxy
    const response = await fetch(request);

    // 3. Simpan ke cache jika valid
    if (response.status === 206 || response.status === 200) {
        const clone = response.clone();
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) <= CHUNK_SIZE * 2) {
            await cache.put(chunkKey, clone);
        }
    }

    return response;
}

// LRU Pruning — batasi total cache 2GB
async function pruneCache() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const keys = await cache.keys();
        const MAX_CHUNKS = 4000; // ~2GB @ 512KB per chunk

        if (keys.length > MAX_CHUNKS) {
            const toDelete = keys.slice(0, Math.floor(keys.length * 0.1));
            for (const key of toDelete) {
                await cache.delete(key);
            }
        }
    } catch (e) {
        console.error('Failed to prune SW cache:', e);
    }
}

// Prune on load and then periodically
pruneCache();
setInterval(pruneCache, 30 * 60 * 1000);
