package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.reads.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CloudReadSchedulingTest {
    @Test fun rapidSelectionsDispatchOnlyLastStableRead() = runBlocking {
        val reads = CloudReadCoalescer(this)
        val dispatched = mutableListOf<Int>()
        var final: Job? = null
        repeat(50) { selection -> final = reads.submit(15) { dispatched.add(selection) } }
        final!!.join()
        assertEquals(listOf(49), dispatched)
    }
    @Test fun scopeChangeCancelsAlreadyStartedCoroutineAndPendingSelection() = runBlocking {
        val reads = CloudReadCoalescer(this)
        val started = CompletableDeferred<Unit>()
        var completed = false
        reads.submit(0) { started.complete(Unit); awaitCancellation() }
        started.await()
        val last = reads.submit(10) { completed = true }
        reads.cancel(); last.join()
        assertTrue(last.isCancelled); assertFalse(completed)
    }
    @Test fun pacingReservesOneStartPerIntervalAcrossParallelReaders() = runBlocking {
        var time = 1000L
        val admission = PacedCloudReads(450, { time }, { time += it })
        val starts = mutableListOf<Long>()
        val jobs = List(12) { launch { admission.awaitTurn(); starts.add(time) } }
        jobs.joinAll()
        assertEquals(12, starts.size)
        assertTrue(starts.zipWithNext().all { (a, b) -> b - a >= 450 })
    }
    @Test fun replacementWaitsForOldCancellationCleanupBeforeDispatch() = runBlocking {
        val reads = CloudReadCoalescer(this)
        val started = CompletableDeferred<Unit>()
        val cleaning = CompletableDeferred<Unit>()
        val cleaned = CompletableDeferred<Unit>()
        var dispatched = false
        reads.submit(0) {
            try { started.complete(Unit); awaitCancellation() }
            finally { withContext(NonCancellable) { cleaning.complete(Unit); cleaned.await() } }
        }
        started.await(); reads.cancel()
        val fresh = reads.submit(0) { dispatched = true }
        cleaning.await(); yield(); assertFalse(dispatched)
        cleaned.complete(Unit); fresh.join(); assertTrue(dispatched)
    }
    @Test fun cancelledAdmissionDoesNotDispatchOrReserveAnotherSlot() = runBlocking {
        var time = 1000L
        val pause = CompletableDeferred<Unit>()
        val admission = PacedCloudReads(450, { time }, { pause.await(); time += it })
        admission.awaitTurn()
        var dispatched = false
        val waiting = launch(start = CoroutineStart.UNDISPATCHED) { admission.awaitTurn(); dispatched = true }
        waiting.cancelAndJoin(); assertFalse(dispatched)
        time = 1450; admission.awaitTurn(); assertEquals(1450L, time)
    }
    @Test fun cacheExpiresAndEvictsByBothBytesAndEntryCount() {
        var time = 1000L
        val cache = ScopedReadCache<String, ByteArray>({ time }, 100, 2, 5) { it.size.toLong() }
        cache.put("one", byteArrayOf(1, 2)); cache.put("two", byteArrayOf(3, 4))
        assertNotNull(cache.get("one"))
        cache.put("three", byteArrayOf(5, 6))
        assertNull(cache.get("two")); assertNotNull(cache.get("one"))
        cache.put("large", ByteArray(6)); assertNull(cache.get("large"))
        time = 1100; assertNull(cache.get("one"))
        cache.clear(); assertNull(cache.get("three"))
    }
    @Test fun nativeReadSchedulingIsolatesAvatarThumbnailAndMetadataLanes() {
        assertNotSame(NativeCloudReadScheduling.metadata, NativeCloudReadScheduling.avatars)
        assertNotSame(NativeCloudReadScheduling.metadata, NativeCloudReadScheduling.thumbnails)
        assertNotSame(NativeCloudReadScheduling.avatars, NativeCloudReadScheduling.thumbnails)
    }
}
