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
 * direct player demand fast-path, and bounded memory ring caching.
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

    // Bounded chunk cache: chunkIndex -> ByteArray (each chunk is up to CHUNK_SIZE bytes)
    private val chunks = LinkedHashMap<Long, ByteArray>(maxCacheChunks, 0.75f, true)
    private val cacheLock = Any()

    // Single-flight in-flight fetch deduplication: chunkIndex -> CompletableDeferred<ByteArray>
    private val inFlight = ConcurrentHashMap<Long, CompletableDeferred<ByteArray>>()

    // Concurrency throttle for MTProto chunk fetching (4 concurrent fetches, matching desktop parallel stream workers)
    private val fetchLimiter = Semaphore(MAX_CONCURRENT_FETCH)

    // Dedicated prefetch scope
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var prefetchJob: Job? = null
    private var prefetchCurrentChunk: Long = -1L
    private val prefetchJobLock = Any()

    init {
        source.onClose { close() }
        // Eager Hot-Head & Moov Tail Startup: eliminates initial seek and container header latency
        scope.launch {
            // Hot Head 0: first 256KB container headers
            runCatching { fetchChunk(0L) }
            // Moov Tail: For videos/files > 1MB, eagerly fetch the tail chunk so MP4 seek to EOF moov atom is 0ms instant
            if (size > 1024 * 1024) {
                val lastChunk = (size - 1) / CHUNK_SIZE
                runCatching { fetchChunk(lastChunk) }
            }
            // Hot Head 1: next 256KB initial audio/video frames
            if (size > CHUNK_SIZE) {
                runCatching { fetchChunk(1L) }
            }
        }
    }

    /**
     * Reads up to [length] bytes starting at [position] from the streaming pipeline.
     * Fast-path: Served immediately from memory cache if chunk is present.
     * Slow-path: Fetches the missing 256KB chunk, stores it, and triggers forward prefetching.
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
                // 2. Direct Player Demand: Chunk is missing, fetch from MTProto with top priority!
                triggerPrefetch(position, forceRestart = true)
                fetchChunk(chunkIndex)
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
     * Redirects prefetch engine immediately to the new target.
     */
    fun onSeek(targetPosition: Long) {
        if (closed.get()) return
        activeCursor.set(targetPosition)
        triggerPrefetch(targetPosition, forceRestart = true)
    }

    /**
     * Triggers speculative background prefetching ahead of [fromPosition].
     * Pipelined chunks are downloaded ahead in parallel batches into the ring cache.
     */
    private fun triggerPrefetch(fromPosition: Long, forceRestart: Boolean = false) {
        if (closed.get()) return
        val currentChunk = fromPosition / CHUNK_SIZE
        val nextChunk = currentChunk + 1
        val lastChunk = (size - 1).coerceAtLeast(0) / CHUNK_SIZE
        if (nextChunk > lastChunk) return

        synchronized(prefetchJobLock) {
            val isJobActive = prefetchJob?.isActive == true
            // If existing prefetch job is active and still within the current runway, do NOT cancel it!
            if (!forceRestart && isJobActive) {
                val distance = currentChunk - prefetchCurrentChunk
                if (distance in 0..6) {
                    return // Current job is already streaming ahead nicely without interruption
                }
            }

            prefetchJob?.cancel()
            prefetchCurrentChunk = currentChunk
            prefetchJob = scope.launch {
                val endChunk = minOf(lastChunk, nextChunk + prefetchRunwayChunks - 1)
                val chunkIndices = (nextChunk..endChunk).toList()

                // Download ahead in parallel batches of MAX_CONCURRENT_FETCH (4 workers)
                for (batch in chunkIndices.chunked(MAX_CONCURRENT_FETCH)) {
                    if (!isActive || closed.get()) break

                    // If player cursor leaped far away (seek occurred), stop this prefetch track
                    val curCursor = activeCursor.get()
                    val curChunk = curCursor / CHUNK_SIZE
                    if (abs(curChunk - batch.first()) > prefetchRunwayChunks + 4) {
                        break
                    }

                    // Parallel fetch within batch matching Desktop multi-worker streaming
                    batch.map { idx ->
                        async {
                            if (!isActive || closed.get()) return@async
                            val alreadyCached = synchronized(cacheLock) { chunks.containsKey(idx) }
                            if (!alreadyCached && !inFlight.containsKey(idx)) {
                                runCatching { fetchChunk(idx) }
                            }
                        }
                    }.awaitAll()
                }
            }
        }
    }

    /**
     * Fetches chunk [chunkIndex] with single-flight deduplication.
     */
    private suspend fun fetchChunk(chunkIndex: Long): ByteArray {
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

        return withContext(NonCancellable) {
            try {
                if (closed.get()) throw IOException("cloud_stream_closed")
                val chunkStart = chunkIndex * CHUNK_SIZE
                val chunkLen = minOf(CHUNK_SIZE.toLong(), size - chunkStart).toInt()
                if (chunkLen <= 0) {
                    val empty = ByteArray(0)
                    deferred.complete(empty)
                    return@withContext empty
                }

                // Acquire permit from fetchLimiter (max 2 concurrent MTProto fetches)
                val bytes = fetchLimiter.withPermit {
                    if (closed.get()) throw IOException("cloud_stream_closed")
                    source.read(chunkStart, chunkLen)
                }

                if (closed.get()) throw IOException("cloud_stream_closed")

                // Store in cache with eviction protection for head and tail
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
                inFlight.remove(chunkIndex)
            }
        }
    }

    /**
     * Evicts chunks when cache exceeds [maxCacheChunks].
     * Protects:
     * - Head chunks (index 0 and 1, holding container header / ftyp)
     * - Tail chunk (last chunk, holding MP4 moov atom)
     * - Chunks closest to the active cursor
     */
    private fun evictOldChunksIfNecessary(currentChunkIndex: Long) {
        val lastChunkIndex = (size - 1).coerceAtLeast(0) / CHUNK_SIZE
        val currentCursorChunk = activeCursor.get() / CHUNK_SIZE

        while (chunks.size > maxCacheChunks) {
            var candidateKey: Long? = null
            var maxDistance = -1L

            for (key in chunks.keys) {
                // Protect head (0, 1) and tail
                if (key in 0L..1L || key == lastChunkIndex) continue

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
                val oldest = chunks.keys.firstOrNull { it !in 0L..1L && it != lastChunkIndex }
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
        const val DEFAULT_MAX_CACHE_CHUNKS = 80 // 80 * 256KB = 20 MB ring buffer
        const val DEFAULT_RUNWAY_CHUNKS = 48 // 48 * 256KB = 12 MB ahead runway (~30-60s buffer)
        const val MAX_CONCURRENT_FETCH = 4 // 4 parallel pipelined MTProto fetches
    }
}
