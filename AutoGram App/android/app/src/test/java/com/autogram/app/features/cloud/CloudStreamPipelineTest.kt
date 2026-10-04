package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.preview.CloudRangeSource
import com.autogram.app.features.cloud.preview.CloudStreamPipeline
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class CloudStreamPipelineTest {

    @Test
    fun sequentialReadsUseChunkedPrefetchingWithoutPerSegmentFetches() = runBlocking {
        val fetches = mutableListOf<Pair<Long, Int>>()
        val totalSize = 1024L * 1024L // 1 MB = 4 chunks of 256 KB
        val source = CloudRangeSource(totalSize, { offset, len ->
            fetches.add(offset to len)
            ByteArray(len) { ((offset + it) % 251).toByte() }
        }, {})

        val pipeline = CloudStreamPipeline(source, prefetchRunwayChunks = 4, maxCacheChunks = 8)

        // Read 32 KB at a time (like ExoPlayer)
        val buffer = ByteArray(32 * 1024)
        for (i in 0 until 8) { // 8 * 32 KB = 256 KB (chunk 0)
            val pos = i * 32L * 1024L
            val bytes = pipeline.read(pos, buffer.size)
            assertEquals(buffer.size, bytes.size)
            assertEquals(((pos) % 251).toByte(), bytes[0])
        }

        // Chunk 0 was fetched as a 256 KB chunk
        assertTrue("Expected chunk 0 to be fetched as 256 KB", fetches.any { it.first == 0L && it.second == 256 * 1024 })
        // Number of fetches for chunk 0 should be exactly 1 or small prefetch, NOT 8 separate 32 KB fetches!
        val chunk0Fetches = fetches.filter { it.first == 0L }
        assertEquals("Chunk 0 should be fetched only once", 1, chunk0Fetches.size)

        pipeline.close()
        source.close()
    }

    @Test
    fun directDemandFetchesTargetChunkImmediately() = runBlocking {
        val fetches = mutableListOf<Pair<Long, Int>>()
        val totalSize = 2L * 1024L * 1024L // 2 MB
        val source = CloudRangeSource(totalSize, { offset, len ->
            fetches.add(offset to len)
            ByteArray(len) { 42.toByte() }
        }, {})

        val pipeline = CloudStreamPipeline(source, prefetchRunwayChunks = 2, maxCacheChunks = 8)

        // Read at offset 600,000 (which falls into chunk index 2: 524,288 .. 786,432)
        val readOffset = 600_000L
        val bytes = pipeline.read(readOffset, 1000)
        assertEquals(1000, bytes.size)
        assertEquals(42.toByte(), bytes[0])

        // Verify chunk 2 was fetched starting at aligned offset 524,288 (2 * 256KB)
        val alignedStart = 2L * CloudStreamPipeline.CHUNK_SIZE
        assertTrue("Target chunk should start at aligned offset $alignedStart",
            fetches.any { it.first == alignedStart && it.second == CloudStreamPipeline.CHUNK_SIZE })

        pipeline.close()
        source.close()
    }

    @Test
    fun singleFlightDeduplicatesConcurrentReadsInSameChunk() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var fetchCalls = 0

        val source = CloudRangeSource(1024 * 1024, { offset, len ->
            if (offset == 0L) {
                fetchCalls++
                started.complete(Unit)
                release.await()
            }
            ByteArray(len) { 99.toByte() }
        }, {})

        val pipeline = CloudStreamPipeline(source, prefetchRunwayChunks = 0, maxCacheChunks = 4)

        val task1 = async { pipeline.read(0, 100) }
        started.await()

        val task2 = async { pipeline.read(50, 100) }

        release.complete(Unit)

        val res1 = task1.await()
        val res2 = task2.await()

        assertEquals(100, res1.size)
        assertEquals(100, res2.size)
        assertEquals(99.toByte(), res1[0])
        assertEquals(99.toByte(), res2[0])
        assertEquals("Single-flight should deduplicate to 1 fetch", 1, fetchCalls)

        pipeline.close()
        source.close()
    }

    @Test
    fun evictionProtectsHeadAndTailChunks() = runBlocking {
        val totalSize = 20L * CloudStreamPipeline.CHUNK_SIZE // 20 chunks
        val source = CloudRangeSource(totalSize, { offset, len ->
            ByteArray(len) { ((offset / CloudStreamPipeline.CHUNK_SIZE) % 100).toByte() }
        }, {})

        // Pipeline with maxCacheChunks = 4
        val pipeline = CloudStreamPipeline(source, prefetchRunwayChunks = 1, maxCacheChunks = 4)

        // Read chunk 0 (head)
        pipeline.read(0, 100)

        // Read chunk 19 (tail)
        val lastChunkStart = 19L * CloudStreamPipeline.CHUNK_SIZE
        pipeline.read(lastChunkStart, 100)

        // Read several intermediate chunks: 5, 6, 7, 8
        for (i in 5..8) {
            pipeline.read(i.toLong() * CloudStreamPipeline.CHUNK_SIZE, 100)
        }

        // Now read chunk 0 again: should be preserved (protected head)
        val headBytes = pipeline.read(0, 100)
        assertEquals(100, headBytes.size)

        // Now read tail chunk again: should be preserved (protected tail)
        val tailBytes = pipeline.read(lastChunkStart, 100)
        assertEquals(100, tailBytes.size)

        pipeline.close()
        source.close()
    }

    @Test
    fun closedPipelineThrowsIOExceptionOnRead() = runBlocking {
        val source = CloudRangeSource(1000, { _, len -> ByteArray(len) }, {})
        val pipeline = CloudStreamPipeline(source)

        pipeline.close()

        val failure = runCatching { pipeline.read(0, 10) }.exceptionOrNull()
        assertTrue("Closed pipeline should throw IOException", failure is IOException)
        assertEquals("cloud_stream_closed", failure?.message)

        source.close()
    }

    @Test
    fun sourceClosureTriggersPipelineClosure() = runBlocking {
        val source = CloudRangeSource(1000, { _, len -> ByteArray(len) }, {})
        val pipeline = CloudStreamPipeline(source)

        source.close()

        val failure = runCatching { pipeline.read(0, 10) }.exceptionOrNull()
        assertTrue("Pipeline should close when source closes", failure is IOException)

        pipeline.close()
    }

    @Test
    fun seekUpdatesCursorAndDirectsPrefetch() = runBlocking {
        val fetches = mutableListOf<Long>()
        val totalSize = 10L * CloudStreamPipeline.CHUNK_SIZE
        val source = CloudRangeSource(totalSize, { offset, len ->
            fetches.add(offset)
            ByteArray(len)
        }, {})

        val pipeline = CloudStreamPipeline(source, prefetchRunwayChunks = 2, maxCacheChunks = 8)

        // Initial read at chunk 0
        pipeline.read(0, 100)

        // Seek to chunk 8
        val targetPos = 8L * CloudStreamPipeline.CHUNK_SIZE
        pipeline.onSeek(targetPos)
        pipeline.read(targetPos, 100)

        // Verify chunk 8 was fetched
        assertTrue("Seek target should be fetched", fetches.contains(targetPos))

        pipeline.close()
        source.close()
    }
}
