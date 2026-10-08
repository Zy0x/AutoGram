package com.autogram.app.features.cloud.reads

import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Intermediate UI selections never reach the native transport. Already-issued RPCs cannot be unsent. */
class CloudReadCoalescer(private val scope: CoroutineScope) {
    private var job: Job? = null
    val isActive get() = job?.isActive == true
    fun cancel() { job?.cancel() }
    fun submit(settleMs: Long = 240, read: suspend () -> Unit): Job {
        val previous = job
        cancel()
        // Drain cancellation so the old store loading/finally state cannot suppress the replacement.
        return scope.launch { previous?.join(); delay(settleMs); ensureActive(); read() }.also { job = it }
    }
}

/** Serial admission, not a lock held during network I/O. No invented server wait/error. */
class PacedCloudReads(private val gapMs: Long = 450,
    private val now: () -> Long = { System.nanoTime() / 1_000_000 },
    private val pause: suspend (Long) -> Unit = { delay(it) }) {
    private val admission = Mutex()
    private var nextAt = 0L
    suspend fun awaitTurn() = admission.withLock {
        while (nextAt > now()) { pause(nextAt - now()); currentCoroutineContext().ensureActive() }
        currentCoroutineContext().ensureActive()
        nextAt = now() + gapMs
    }
}

/** All native cloud adapter instances share metadata admission; streaming has its own lifetime. */
internal object NativeCloudReadScheduling {
    val metadata = PacedCloudReads()
    // Optional batches hydrate message IDs and download several layers, not a single RPC.
    // Keep a separate conservative lane without slowing preview byte ranges.
    val thumbnails = PacedCloudReads(gapMs = 2_000)
}
