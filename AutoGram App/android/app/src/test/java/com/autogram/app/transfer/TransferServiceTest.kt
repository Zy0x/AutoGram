package com.autogram.app.transfer

import com.autogram.app.transfer.domain.TransferErrors
import com.autogram.app.transfer.domain.TransferTaskItem
import com.autogram.app.transfer.service.TransferService
import com.autogram.app.transfer.service.updateTransferPause
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class TransferServiceTest {
    private class FakeTransfers(var records: List<TransferTaskItem>) : TransferService {
        val writes = mutableListOf<Pair<String, Boolean>>()
        var rejectedId: String? = null
        var writeFailure: Throwable? = null
        var refreshFailure: Throwable? = null
        var reads = 0

        override fun list(): List<TransferTaskItem> {
            reads += 1
            if (reads > 1) refreshFailure?.let { throw it }
            return records
        }

        override fun setPaused(id: String, paused: Boolean): Boolean {
            writes += id to paused
            writeFailure?.let { throw it }
            if (id == rejectedId) return false
            records = records.map {
                if (it.id == id) it.copy(paused = paused, status = if (paused) "paused" else "queued") else it
            }
            return true
        }
    }

    @Test
    fun bulkControlsPersistAndRefreshNativeState() = runBlocking {
        val service = FakeTransfers(listOf(transferTask(), transferTask("done", "completed")))
        val paused = updateTransferPause(service, true)
        assertEquals(listOf("one" to true), service.writes)
        assertTrue(paused.tasks!!.first().paused)
        assertEquals("paused", paused.tasks.first().status)
        assertNull(paused.errorCode)
        val resumed = updateTransferPause(service, false)
        assertEquals(listOf("one" to true, "one" to false), service.writes)
        assertFalse(resumed.tasks!!.first().paused)
        assertEquals("queued", resumed.tasks.first().status)
    }

    @Test
    fun emptyQueueDoesNotCreateTasksOrWriteAnything() = runBlocking {
        val service = FakeTransfers(emptyList())
        val result = updateTransferPause(service, true)
        assertTrue(result.tasks!!.isEmpty())
        assertTrue(service.writes.isEmpty())
        assertNull(result.errorCode)
    }

    @Test
    fun rejectedWriteReportsFailureAndPreservesPartialNativeSuccess() = runBlocking {
        val service = FakeTransfers(listOf(transferTask(), transferTask("two")))
        service.rejectedId = "one"
        val result = updateTransferPause(service, true)
        assertEquals(TransferErrors.PAUSE_FAILED, result.errorCode)
        assertFalse(result.tasks!![0].paused)
        assertTrue(result.tasks[1].paused)
        assertEquals(2, service.writes.size)
    }

    @Test
    fun exceptionReportsStableCodeWithoutLeakingNativeMessage() = runBlocking {
        val service = FakeTransfers(listOf(transferTask()))
        service.writeFailure = IllegalStateException("private native detail")
        val result = updateTransferPause(service, true)
        assertEquals(TransferErrors.PAUSE_FAILED, result.errorCode)
        assertFalse(result.tasks!!.first().paused)
    }

    @Test
    fun missingNativeSymbolHasDistinctErrorAndStopsFurtherWrites() = runBlocking {
        val service = FakeTransfers(listOf(transferTask(), transferTask("two")))
        service.writeFailure = UnsatisfiedLinkError("missing symbol")
        val result = updateTransferPause(service, true)
        assertEquals(TransferErrors.NATIVE_UNAVAILABLE, result.errorCode)
        assertEquals(1, service.writes.size)
        assertTrue(result.tasks!!.none { it.paused })
    }

    @Test
    fun cancellationPropagatesWithoutFurtherWritesOrRefresh() = runBlocking {
        val service = FakeTransfers(listOf(transferTask(), transferTask("two")))
        val cancellation = CancellationException("cancelled")
        service.writeFailure = cancellation
        try {
            updateTransferPause(service, true)
            fail("Cancellation must propagate")
        } catch (actual: CancellationException) {
            assertSame(cancellation, actual)
        }
        assertEquals(1, service.writes.size)
        assertEquals(1, service.reads)
    }

    @Test
    fun refreshFailureDoesNotPublishAnOptimisticSnapshot() = runBlocking {
        val service = FakeTransfers(listOf(transferTask()))
        service.refreshFailure = IllegalStateException("reload failed")
        val result = updateTransferPause(service, true)
        assertNull(result.tasks)
        assertEquals(TransferErrors.LOAD_FAILED, result.errorCode)
    }

    @Test
    fun missingOrTerminalToggleReportsFailureWithoutMutating() = runBlocking {
        val service = FakeTransfers(listOf(transferTask("done", "completed")))
        assertEquals(TransferErrors.PAUSE_FAILED, updateTransferPause(service, null, "gone").errorCode)
        assertEquals(TransferErrors.PAUSE_FAILED, updateTransferPause(service, null, "done").errorCode)
        assertTrue(service.writes.isEmpty())
    }

    @Test
    fun toggleReadsLatestNativeStateInsteadOfStaleUiPauseFlag() = runBlocking {
        val service = FakeTransfers(listOf(transferTask(paused = true, status = "paused")))
        val result = updateTransferPause(service, null, "one")
        assertEquals(listOf("one" to false), service.writes)
        assertFalse(result.tasks!!.first().paused)
    }
}
