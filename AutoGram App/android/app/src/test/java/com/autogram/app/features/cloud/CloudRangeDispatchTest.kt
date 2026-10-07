package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.preview.CloudRangeSource
import java.util.concurrent.Executors
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Test

/** Transport setup and byte conversion must not occupy the UI caller's dispatcher. */
class CloudRangeDispatchTest {
    @Test fun blockingTransportNeverRunsOnThePreviewCallerThread() = runBlocking {
        Executors.newSingleThreadExecutor { task -> Thread(task, "preview-caller") }
            .asCoroutineDispatcher().use { caller ->
                withContext(caller) {
                    val callerThread = Thread.currentThread()
                    var transportThread: Thread? = null
                    val expected = byteArrayOf(1, 2, 3, 4)
                    val source = CloudRangeSource(4, { offset, length ->
                        transportThread = Thread.currentThread()
                        check(offset == 0L && length == 4)
                        expected.copyOf()
                    }, {})
                    try {
                        assertArrayEquals(expected, source.read(0, 4))
                        assertNotSame("Transport must not occupy the UI caller", callerThread, transportThread)
                        assertSame("The result must resume on the original caller", callerThread, Thread.currentThread())
                    } finally {
                        source.close()
                    }
                }
            }
    }
}
