package com.autogram.app.transfer

import com.autogram.app.transfer.domain.TransferPauseChange
import com.autogram.app.transfer.domain.TransferRequestGuard
import com.autogram.app.transfer.domain.TransferTaskItem
import com.autogram.app.transfer.domain.selectPauseChanges
import com.autogram.app.transfer.domain.summarizeTransfers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

internal fun transferTask(
    id: String = "one",
    status: String = "queued",
    paused: Boolean = false,
    total: Long = 100,
    processed: Long = 0
) = TransferTaskItem(
    id, "$id.bin", total, processed, 0, 0, status, "upload", paused, 1, "local", "cloud"
)

class TransferDomainTest {
    @Test
    fun emptyNativeQueueStaysEmptyWithZeroProgress() {
        val summary = summarizeTransfers(emptyList())
        assertTrue(summary.activeTasks.isEmpty())
        assertTrue(summary.completedTasks.isEmpty())
        assertEquals(0f, summary.aggregateProgress, 0f)
    }

    @Test
    fun terminalStatusesArePartitionedCaseInsensitivelyWithoutLosingOrder() {
        val tasks = listOf("queued", "COMPLETED", "paused", "failed", "cancelled", "skipped")
            .mapIndexed { index, status -> transferTask(index.toString(), status) }
        val summary = summarizeTransfers(tasks)
        assertEquals(listOf(tasks[0], tasks[2]), summary.activeTasks)
        assertEquals(listOf(tasks[1], tasks[3], tasks[4], tasks[5]), summary.completedTasks)
    }

    @Test
    fun aggregateUsesByteWeightsAcrossActiveAndTerminalTasks() {
        val summary = summarizeTransfers(listOf(
            transferTask(total = 300, processed = 150),
            transferTask("two", "completed", total = 100, processed = 100)
        ))
        assertEquals(0.625f, summary.aggregateProgress, 0.00001f)
    }

    @Test
    fun invalidAndUnknownByteCountersDoNotProduceInventedProgress() {
        assertEquals(0f, summarizeTransfers(listOf(
            transferTask(total = -1, processed = 900),
            transferTask("two", total = 0, processed = 900)
        )).aggregateProgress, 0f)
        assertEquals(0.5f, summarizeTransfers(listOf(
            transferTask(total = 100, processed = -20),
            transferTask("two", total = 100, processed = 900)
        )).aggregateProgress, 0f)
    }

    @Test
    fun queueByteSumCannotOverflowLong() {
        val summary = summarizeTransfers(listOf(
            transferTask(total = Long.MAX_VALUE, processed = Long.MAX_VALUE),
            transferTask("two", total = Long.MAX_VALUE, processed = 0)
        ))
        assertEquals(0.5f, summary.aggregateProgress, 0.00001f)
    }

    @Test
    fun bulkPauseAndResumeExcludeTerminalAndAlreadyMatchingTasks() {
        val tasks = listOf(
            transferTask("running"), transferTask("paused", paused = true),
            transferTask("status-paused", status = "PAUSED"),
            transferTask("done", "completed"), transferTask("failed", "failed", paused = true),
            transferTask("cancelled", "cancelled"), transferTask("skipped", "skipped")
        )
        assertEquals(listOf(TransferPauseChange("running", true)), selectPauseChanges(tasks, true))
        assertEquals(listOf(
            TransferPauseChange("paused", false), TransferPauseChange("status-paused", false)
        ), selectPauseChanges(tasks, false))
    }

    @Test
    fun toggleUsesCurrentTaskStateAndIgnoresMissingOrTerminalTasks() {
        val tasks = listOf(transferTask(paused = true), transferTask("done", "completed"))
        assertEquals(listOf(TransferPauseChange("one", false)), selectPauseChanges(tasks, null, "one"))
        assertTrue(selectPauseChanges(tasks, null, "missing").isEmpty())
        assertTrue(selectPauseChanges(tasks, null, "done").isEmpty())
    }

    @Test
    fun olderRequestsCannotPublishAfterAnotherRequestStarts() {
        val guard = TransferRequestGuard()
        val firstLoad = guard.next()
        val pause = guard.next()
        assertFalse(guard.isCurrent(firstLoad))
        assertTrue(guard.isCurrent(pause))
        val refresh = guard.next()
        assertFalse(guard.isCurrent(pause))
        assertTrue(guard.isCurrent(refresh))
    }
}
