package com.autogram.app.features.cloudtransfer.storage

import java.io.InputStream
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test

class PublicationCancellationTest {
    @Test fun coroutineCancellationClosesBlockedStreamAndCancelsOpen() = runBlocking {
        val reading = CountDownLatch(1)
        val closed = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val openCancelled = AtomicBoolean(false)
        val returnedSuccess = AtomicBoolean(false)
        val task = async {
            publicationIO({ openCancelled.set(true) }) { cancellation ->
                try {
                    cancellation.track(object : InputStream() {
                        override fun read(): Int {
                            reading.countDown()
                            check(closed.await(5, TimeUnit.SECONDS))
                            throw IOException("closed synthetic stream")
                        }
                        override fun close() { closed.countDown() }
                    }).use { it.read() }
                    returnedSuccess.set(true)
                } finally { finished.countDown() }
            }
        }
        // Let async enter the IO worker before waiting on its synthetic blocking operation.
        kotlinx.coroutines.yield()
        assertTrue(reading.await(5, TimeUnit.SECONDS))
        withTimeout(5000) { task.cancelAndJoin() }
        assertTrue(openCancelled.get())
        assertTrue(closed.await(5, TimeUnit.SECONDS))
        assertTrue(finished.await(5, TimeUnit.SECONDS))
        assertFalse(returnedSuccess.get())
    }

    @Test fun lateResourceIsImmediatelyClosedAfterCancellation() {
        val control = PublicationCancellation()
        var closed = false
        control.cancel()
        assertThrows(java.util.concurrent.CancellationException::class.java) {
            control.track(object : InputStream() {
                override fun read(): Int = -1
                override fun close() { closed = true }
            })
        }
        assertTrue(closed)
    }

    @Test fun normalCompletionClosesOnlyOnceAndCancelDoesNotReclose() {
        val control = PublicationCancellation()
        var closes = 0
        control.track(object : InputStream() {
            override fun read(): Int = -1
            override fun close() { closes++ }
        }).use { it.read() }
        control.cancel()
        assertEquals(1, closes)
    }
}
