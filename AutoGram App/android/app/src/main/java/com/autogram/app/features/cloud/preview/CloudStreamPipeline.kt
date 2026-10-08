package com.autogram.app.features.cloud.preview

import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.Closeable
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs

/**
 * Pipelined Anti-Buffering Media Streaming Engine.
 *
 * Implements Desktop-parity chunk prefetching, proactive runway buffering,
 * direct player demand fast-path, continuous sliding-window worker pool,
 * and bounded memory ring caching.
 */
class CloudStreamPipeline(
    val source: CloudRangeSource,
    private val prefetchRunwayChunks: Int = DEFAULT_RUNWAY_CHUNKS,
    private val maxCacheChunks: Int = DEFAULT_MAX_CACHE_CHUNKS,
    private val diskCache: SparseDiskStreamCache? = null
) : Closeable {

    val size: Long get() = source.size

    private val closed = AtomicBoolean(false)
    private val activeCursor = AtomicLong(0L)
    // Parsing headers and restoring a saved position are demand-only. The player's
    // confirmed playing event opens the unchanged steady-state runway.
    private val playbackActive = AtomicBoolean(false)

    // Bounded chunk cache: chunkIndex -> ByteArray (each chunk is up to CHUNK_SIZE bytes)
    private val chunks = LinkedHashMap<Long, ByteArray>(maxCacheChunks, 0.75f, true)
    private val cacheLock = Any()

    // Single-flight in-flight fetch deduplication: chunkIndex -> CompletableDeferred<ByteArray>
    private val inFlight = ConcurrentHashMap<Long, CompletableDeferred<ByteArray>>()

    // Concurrency throttle reserved exclusively for background prefetch workers
    // Direct player demand bypasses this limiter so seeking and immediate reads never wait!
    private val prefetchLimiter = Semaphore(MAX_CONCURRENT_FETCH)

    // Dedicated prefetch scope
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var prefetchJob: Job? = null
    private var prefetchAnchorChunk: Long = -1L
    private val prefetchJobLock = Any()

    init {
        source.onClose { close() }
    }

    fun setPlaybackActive(active: Boolean) {
        playbackActive.set(active)
        if (active) triggerPrefetch(activeCursor.get(), forceRestart = true)
        else synchronized(prefetchJobLock) {
            prefetchJob?.cancel()
            prefetchJob = null
        }
    }

    /**
     * Reads up to [length] bytes starting at [position] from the streaming pipeline.
     * Fast-path: Served immediately from memory cache if chunk is present (0 ms).
     * Disk-path: Served from local session disk cache (<1 ms).
     * Demand-path: Fetches the missing chunk with top priority (Demand Fast-Path)
     * and triggers continuous forward prefetching.
     */
    suspend fun read(position: Long, length: Int): ByteArray {
        if (closed.get()) throw IOException("cloud_stream_closed")
        if (position < 0 || length < 0) throw IOException("invalid_range")
        if (position >= size || length == 0) return ByteArray(0)

        activeCursor.set(position)
        val chunkIndex = position / CHUNK_SIZE
        val chunkOffset = (position % CHUNK_SIZE).toInt()

        // 1. Fast-Path A: Check memory cache (0 ms)
        val cachedChunk = synchronized(cacheLock) { chunks[chunkIndex] }
        val chunkData = if (cachedChunk != null) {
            cachedChunk
        } else {
            // 1. Fast-Path B: Check local sparse disk cache (<1 ms)
            val chunkStart = chunkIndex * CHUNK_SIZE
            val expectedLen = minOf(CHUNK_SIZE.toLong(), size - chunkStart).toInt()
            val diskBytes = diskCache?.readRange(chunkStart, expectedLen)
            if (diskBytes != null) {
                synchronized(cacheLock) {
                    chunks[chunkIndex] = diskBytes
                    evictOldChunksIfNecessary(chunkIndex)
                }
                diskBytes
            } else {
                // 2. Direct Player Demand: Missing chunk requested by player right now!
                // Prioritize this demand fetch immediately, bypassing background prefetch limiter.
                triggerPrefetch(position, forceRestart = false)
                fetchChunkDemand(chunkIndex)
            }
        }

        if (closed.get()) throw IOException("cloud_stream_closed")

        // 3. Slice the requested bytes from the chunk
        val availableInChunk = chunkData.size - chunkOffset
        if (availableInChunk <= 0) return ByteArray(0)

        val toRead = minOf(length, availableInChunk)
        val result = chunkData.copyOfRange(chunkOffset, chunkOffset + toRead)

        // 4. Update cursor and ensure prefetch pipeline stays ahead of playback
        val nextPosition = position + toRead
        activeCursor.set(nextPosition)
        triggerPrefetch(nextPosition, forceRestart = false)

        return result
    }

    /**
     * Called when the player seeks to a new position.
     * Redirects prefetch engine immediately to the new target and cancels obsolete tasks.
     */
    fun onSeek(targetPosition: Long) {
        if (closed.get()) return
        activeCursor.set(targetPosition)
        val targetChunk = targetPosition / CHUNK_SIZE

        synchronized(prefetchJobLock) {
            prefetchJob?.cancel()
            prefetchJob = null
            prefetchAnchorChunk = targetChunk
        }

        // Cancel and prune in-flight tasks that are far from the new seek position
        val toCancel = inFlight.entries.filter { (idx, _) ->
            abs(idx - targetChunk) > 2
        }
        toCancel.forEach { (idx, deferred) ->
            deferred.cancel(CancellationException("seek_redirected"))
            inFlight.remove(idx)
        }

        triggerPrefetch(targetPosition, forceRestart = true)
    }

    /**
     * Triggers speculative background prefetching ahead of [fromPosition].
     * Uses a continuous sliding-window worker pool without batch barrier stalls.
     */
    private fun triggerPrefetch(fromPosition: Long, forceRestart: Boolean = false) {
        if (closed.get() || !playbackActive.get()) return
        val currentChunk = fromPosition / CHUNK_SIZE
        val nextChunk = currentChunk + 1
        val lastChunk = (size - 1).coerceAtLeast(0) / CHUNK_SIZE
        if (nextChunk > lastChunk) return

        synchronized(prefetchJobLock) {
            val isJobActive = prefetchJob?.isActive == true
            // If existing prefetch job is active and still ahead of current playback, do NOT cancel it!
            if (!forceRestart && isJobActive) {
                val distance = currentChunk - prefetchAnchorChunk
                // Only restart if cursor jumped backwards or jumped far ahead of the current track
                if (distance in 0..12) {
                    return // Current job is already streaming ahead nicely without interruption
                }
            }

            prefetchJob?.cancel()
            prefetchAnchorChunk = currentChunk
            prefetchJob = scope.launch {
                val endChunk = minOf(lastChunk, nextChunk + prefetchRunwayChunks - 1)
                if (nextChunk > endChunk) return@launch

                // Continuous Sliding-Window Worker Pool:
                // Workers continuously pick the next missing chunk index without waiting for a batch barrier.
                val nextIndexToFetch = AtomicLong(nextChunk)
                val workerJobs = (0 until MAX_CONCURRENT_FETCH).map {
                    async {
                        while (isActive && !closed.get() && playbackActive.get()) {
                            val idx = nextIndexToFetch.getAndIncrement()
                            if (idx > endChunk) break

                            // If player cursor leaped far away (seek occurred), stop this prefetch track
                            val curCursor = activeCursor.get()
                            val curChunk = curCursor / CHUNK_SIZE
                            if (abs(curChunk - idx) > prefetchRunwayChunks + 6) break

                            val alreadyCached = synchronized(cacheLock) { chunks.containsKey(idx) }
                            if (!alreadyCached && !inFlight.containsKey(idx)) {
                                prefetchLimiter.withPermit {
                                    if (!isActive || closed.get()) return@withPermit
                                    runCatching { fetchChunkInternal(idx) }
                                }
                            }
                        }
                    }
                }
                workerJobs.awaitAll()
            }
        }
    }

    /**
     * Direct Player Demand Fetch: Bypasses prefetchLimiter so playback start and seek
     * get immediate CPU and network allocation.
     */
    private suspend fun fetchChunkDemand(chunkIndex: Long): ByteArray {
        return fetchChunkInternal(chunkIndex)
    }

    /**
     * Fetches chunk [chunkIndex] with single-flight deduplication and disk cache persistence.
     */
    private suspend fun fetchChunkInternal(chunkIndex: Long): ByteArray {
        if (closed.get()) throw IOException("cloud_stream_closed")

        // Check if already in cache
        synchronized(cacheLock) {
            chunks[chunkIndex]?.let { return it }
        }

        // Single-flight deduplication: reuse in-flight deferred if already running
        val deferred = CompletableDeferred<ByteArray>()
        val existing = inFlight.putIfAbsent(chunkIndex, deferred)
        if (existing != null) {
            return existing.await()
        }

        return try {
            if (closed.get()) throw IOException("cloud_stream_closed")
            val chunkStart = chunkIndex * CHUNK_SIZE
            val chunkLen = minOf(CHUNK_SIZE.toLong(), size - chunkStart).toInt()
            if (chunkLen <= 0) {
                val empty = ByteArray(0)
                deferred.complete(empty)
                return empty
            }

            val bytes = source.read(chunkStart, chunkLen)
            if (closed.get()) throw IOException("cloud_stream_closed")

            // Store in cache with eviction protection for head, tail, and active runway
            synchronized(cacheLock) {
                chunks[chunkIndex] = bytes
                evictOldChunksIfNecessary(chunkIndex)
            }

            // Persist chunk to session sparse disk cache
            diskCache?.writeChunk(chunkStart, bytes)

            deferred.complete(bytes)
            bytes
        } catch (t: Throwable) {
            deferred.completeExceptionally(t)
            throw t
        } finally {
            inFlight.remove(chunkIndex, deferred)
        }
    }

    /**
     * Evicts chunks when cache exceeds [maxCacheChunks].
     * Protects:
     * - Head chunks (index 0 and 1, holding container header / ftyp)
     * - Tail chunks (holding MP4 moov atom)
     * - Chunks closest to the active cursor
     */
    private fun evictOldChunksIfNecessary(currentChunkIndex: Long) {
        val lastChunkIndex = (size - 1).coerceAtLeast(0) / CHUNK_SIZE
        val currentCursorChunk = activeCursor.get() / CHUNK_SIZE

        while (chunks.size > maxCacheChunks) {
            var candidateKey: Long? = null
            var maxDistance = -1L

            for (key in chunks.keys) {
                // Protect head (0, 1) and tail chunks
                if (key in 0L..1L || key >= lastChunkIndex - 1) continue

                val distance = abs(key - currentCursorChunk)
                if (distance > maxDistance) {
                    maxDistance = distance
                    candidateKey = key
                }
            }

            if (candidateKey != null && maxDistance > 4) {
                chunks.remove(candidateKey)
            } else {
                // Fallback: evict oldest entry if cannot find distant non-protected chunk
                val oldest = chunks.keys.firstOrNull { it !in 0L..1L && it < lastChunkIndex - 1 }
                    ?: chunks.keys.firstOrNull()
                if (oldest != null) {
                    chunks.remove(oldest)
                } else {
                    break
                }
            }
        }
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            synchronized(prefetchJobLock) {
                prefetchJob?.cancel()
                prefetchJob = null
            }
            scope.cancel()
            synchronized(cacheLock) {
                chunks.clear()
            }
            inFlight.values.forEach { it.cancel() }
            inFlight.clear()
            diskCache?.close()
        }
    }

    companion object {
        const val CHUNK_SIZE = 256 * 1024 // 256 KB matching CloudRangeSource.MAX_READ
        const val DEFAULT_MAX_CACHE_CHUNKS = 96 // 96 * 256KB = 24 MB ring buffer
        const val DEFAULT_RUNWAY_CHUNKS = 12 // 12 * 256KB = 3 MB ahead runway (avoids FloodWait burst)
        const val MAX_CONCURRENT_FETCH = 2 // 2 parallel pipelined MTProto workers
    }
}
