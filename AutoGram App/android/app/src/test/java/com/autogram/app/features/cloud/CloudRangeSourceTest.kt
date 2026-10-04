package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.preview.CloudRangeSource
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CloudRangeSourceTest {
    @Test fun repeatedMetadataAndContainedReadsReuseExactBytesWithoutReadAhead() = runBlocking {
        val reads = mutableListOf<Pair<Long, Int>>()
        val source = CloudRangeSource(100000, { o, n ->
            reads.add(o to n); ByteArray(n) { ((o + it) % 251).toByte() }
        }, {})
        val first = source.read(9003, 4096)
        assertArrayEquals(first.copyOfRange(10, 30), source.read(9013, 20))
        first[0] = 0 // caller mutation must not corrupt the capability cache
        assertEquals((9003 % 251).toByte(), source.read(9003, 4096)[0])
        assertEquals(listOf(9003L to 4096), reads)
        source.read(5, 7)
        assertEquals(5L to 7, reads.last())
        source.close()
    }

    @Test fun cacheEvictionNeverChangesSeekOffsetsOrCrossesCapabilities() = runBlocking {
        var calls = 0
        val source = CloudRangeSource(10L * CloudRangeSource.MAX_READ,
            { _, n -> calls++; ByteArray(n) }, {})
        repeat(5) { source.read(it.toLong() * CloudRangeSource.MAX_READ, CloudRangeSource.MAX_READ) }
        source.read(0, CloudRangeSource.MAX_READ)
        assertEquals(6, calls)
        val other = CloudRangeSource(10, { _, n -> calls++; ByteArray(n) { 7 } }, {})
        assertEquals(7.toByte(), other.read(0, 1)[0])
        assertEquals(7, calls)
        source.close(); other.close()
    }

    @Test fun concurrentRepeatedReadsUseOneFetch() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var calls = 0
        val source = CloudRangeSource(100, { _, n ->
            calls++; started.complete(Unit); release.await(); ByteArray(n)
        }, {})
        val first = async { source.read(0, 100) }
        started.await()
        val second = async { source.read(10, 10) }
        release.complete(Unit)
        assertEquals(100, first.await().size)
        assertEquals(10, second.await().size)
        assertEquals(1, calls)
        source.close()
    }
    @Test fun resumeReadsDestinationDirectlyAndCapsEveryRead() = runBlocking {
        val reads = mutableListOf<Pair<Long, Int>>()
        val source = CloudRangeSource(8L * 1024 * 1024 * 1024,
            { offset, length -> reads.add(offset to length); ByteArray(length) }, {})
        val offset = 6L * 1024 * 1024 * 1024 + 3
        assertEquals(256 * 1024, source.read(offset, Int.MAX_VALUE).size)
        assertEquals(listOf(offset to 256 * 1024), reads)
    }
    @Test fun tailAndEndOfFileDoNotReadBeyondSize() = runBlocking {
        val reads = mutableListOf<Pair<Long, Int>>()
        val source = CloudRangeSource(100, { o, n -> reads.add(o to n); ByteArray(n) }, {})
        assertEquals(3, source.read(97, 10).size)
        assertTrue(source.read(100, 100).isEmpty())
        assertTrue(source.read(Long.MAX_VALUE, 100).isEmpty())
        assertEquals(listOf(97L to 3), reads)
    }
    @Test fun closeIsIdempotentAndClosedSourceCannotPublishLateBytes() = runBlocking {
        var releases = 0
        val pending = CompletableDeferred<ByteArray>()
        val source = CloudRangeSource(10, { _, _ -> pending.await() }, { releases++ })
        val request = async(start = CoroutineStart.UNDISPATCHED) {
            runCatching { source.read(0, 10) }.exceptionOrNull()
        }
        source.close(); source.close(); pending.complete(ByteArray(10))
        assertEquals("cloud_stream_closed", (request.await() as CloudFailure).code)
        assertEquals(1, releases)
    }
    @Test fun shortNativeResultIsFailureNotACompletedPreview() = runBlocking {
        val source = CloudRangeSource(10, { _, _ -> ByteArray(9) }, {})
        val failure = runCatching { source.read(0, 10) }.exceptionOrNull() as CloudFailure
        assertEquals("cloud_media_truncated", failure.code)
    }
    @Test fun invalidRangesNeverReachTransport() = runBlocking {
        val source = CloudRangeSource(10, { _, _ -> error("must-not-call") }, {})
        assertEquals("invalid_range", (runCatching { source.read(-1, 1) }.exceptionOrNull() as CloudFailure).code)
        assertEquals("invalid_range", (runCatching { source.read(0, -1) }.exceptionOrNull() as CloudFailure).code)
    }
}
