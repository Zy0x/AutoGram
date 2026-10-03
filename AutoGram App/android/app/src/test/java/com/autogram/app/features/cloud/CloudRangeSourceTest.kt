package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.preview.CloudRangeSource
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CloudRangeSourceTest {
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
