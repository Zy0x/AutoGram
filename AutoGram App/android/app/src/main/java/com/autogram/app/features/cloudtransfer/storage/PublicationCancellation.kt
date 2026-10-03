package com.autogram.app.features.cloudtransfer.storage

import java.io.Closeable
import java.io.FilterInputStream
import java.io.FilterOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine

internal suspend fun <T> publicationIO(
    cancelOpen: () -> Unit = {},
    block: (PublicationCancellation) -> T,
): T = suspendCancellableCoroutine { continuation ->
    val cancellation = PublicationCancellation(cancelOpen)
    continuation.invokeOnCancellation { cancellation.cancel() }
    Dispatchers.IO.dispatch(continuation.context, Runnable {
        try {
            cancellation.check()
            val result = block(cancellation)
            cancellation.check()
            continuation.resume(result)
        } catch (_: CancellationException) {
            continuation.cancel(CancellationException("Output publication cancelled"))
        } catch (failure: Throwable) {
            continuation.resumeWithException(failure)
        }
    })
}

/** Cancellation also closes blocked IO, not just a flag checked between chunks. */
internal class PublicationCancellation(private val cancelOpen: () -> Unit = {}) {
    private val cancelled = AtomicBoolean(false)
    private val resources = mutableSetOf<Closeable>()

    fun check() {
        if (cancelled.get()) throw CancellationException("Output publication cancelled")
    }

    fun cancel() {
        if (!cancelled.compareAndSet(false, true)) return
        runCatching { cancelOpen() }
        val active = synchronized(resources) { resources.toList().also { resources.clear() } }
        // Best effort here; the publishing use-block still observes close errors normally.
        active.forEach { runCatching { it.close() } }
    }

    fun track(input: InputStream): InputStream = object : FilterInputStream(input) {
        private val closed = AtomicBoolean(false)
        override fun close() {
            if (closed.compareAndSet(false, true)) {
                synchronized(resources) { resources.remove(this) }
                super.close()
            }
        }
    }.also { register(it) }

    fun track(output: OutputStream): OutputStream = object : FilterOutputStream(output) {
        private val closed = AtomicBoolean(false)
        override fun write(bytes: ByteArray, offset: Int, length: Int) = out.write(bytes, offset, length)
        override fun close() {
            if (closed.compareAndSet(false, true)) {
                synchronized(resources) { resources.remove(this) }
                // Direct close avoids FilterOutputStream swallowing a flush failure on old APIs.
                out.close()
            }
        }
    }.also { register(it) }

    private fun register(resource: Closeable) {
        val reject = synchronized(resources) {
            if (cancelled.get()) true else { resources.add(resource); false }
        }
        if (reject) {
            runCatching { resource.close() }
            check()
        }
    }
}
