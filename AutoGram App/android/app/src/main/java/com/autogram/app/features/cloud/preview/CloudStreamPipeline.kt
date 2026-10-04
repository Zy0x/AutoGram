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
    private val maxCacheChunks: Int = DEFAULT_MAX_CACHE_CHUNKS
) : Closeable {

    val size: Long get() = source.size

    private val closed = AtomicBoolean(false)
    private val activeCursor = AtomicLong(0L)

    // Bounded chunk cache: chunkIndex -> ByteArray (each chunk is up to CHUNK_SIZE bytes)
    private val chunks = LinkedHashMap<Long, ByteArray>(maxCacheChunks, 0.75f, true)
    private val cacheLock = Any()

    // Single-flight in-flight fetch deduplication: chunkIndex -> CompletableDeferred<ByteArray>
    private val inFlight = ConcurrentHashMap<Long, CompletableDeferred<ByteArray>>()

    // Concurrency throttle for MTProto chunk fetching (2 concurrent fetches, matching desktop stream pacing)
    private val fetchLimiter = Semaphore(MAX_CONCURRENT_FETCH)

    // Dedicated prefetch scope
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var prefetchJob: Job? = null
    private val prefetchJobLock = Any()

    init {
        source.onClose { close() }
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

        // 1. Fast-Path: Check memory cache
        val cachedChunk = synchronized(cacheLock) { chunks[chunkIndex] }
        val chunkData = if (cachedChunk != null) {
            cachedChunk
        } else {
            // 2. Direct Player Demand: Chunk is missing, fetch with top priority!
            // Direct demand interrupts background speculative prefetching
            triggerPrefetch(position)
            fetchChunk(chunkIndex)
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
        triggerPrefetch(nextPosition)

        return result
    }

    /**
     * Called when the player seeks to a new position.
     * Redirects prefetch engine immediately to the new target.
     */
    fun onSeek(targetPosition: Long) {
        if (closed.get()) return
        activeCursor.set(targetPosition)
        triggerPrefetch(targetPosition)
    }

    /**
     * Triggers speculative background prefetching ahead of [fromPosition].
     * Pipelined chunks are downloaded ahead into the ring cache.
     */
    private fun triggerPrefetch(fromPosition: Long) {
        if (closed.get()) return
        val currentChunk = fromPosition / CHUNK_SIZE
        val nextChunk = currentChunk + 1
        val lastChunk = (size - 1).coerceAtLeast(0) / CHUNK_SIZE
        if (nextChunk > lastChunk) return

        synchronized(prefetchJobLock) {
            // Cancel previous prefetch job if it's lagging far behind or ahead
            prefetchJob?.cancel()
            prefetchJob = scope.launch {
                val endChunk = minOf(lastChunk, nextChunk + prefetchRunwayChunks - 1)

                for (idx in nextChunk..endChunk) {
                    if (!isActive || closed.get()) break

                    // If active cursor moved significantly (user sought), abort this prefetch loop
                    val curCursor = activeCursor.get()
                    val curChunk = curCursor / CHUNK_SIZE
                    if (abs(curChunk - idx) > prefetchRunwayChunks + 2) {
                        break
                    }

                    // Check if chunk is already cached or currently in flight
                    val alreadyCached = synchronized(cacheLock) { chunks.containsKey(idx) }
                    if (alreadyCached || inFlight.containsKey(idx)) {
                        continue
                    }

                    // Fetch the chunk in background
                    try {
                        fetchChunk(idx)
                    } catch (e: CancellationException) {
                        break
                    } catch (_: Exception) {
                        // Background prefetch error is non-fatal; player will retry on demand if needed
                        break
                    }

                    // Small cooperative pacing delay (20ms) to prevent thread starvation
                    delay(20)
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
        }
    }

    companion object {
        const val CHUNK_SIZE = 256 * 1024 // 256 KB matching CloudRangeSource.MAX_READ
        const val DEFAULT_MAX_CACHE_CHUNKS = 64 // 64 * 256KB = 16 MB ring buffer
        const val DEFAULT_RUNWAY_CHUNKS = 32 // 32 * 256KB = 8 MB ahead runway (~15-30s buffer)
        const val MAX_CONCURRENT_FETCH = 2 // 2 pipelined MTProto fetches
    }
}
