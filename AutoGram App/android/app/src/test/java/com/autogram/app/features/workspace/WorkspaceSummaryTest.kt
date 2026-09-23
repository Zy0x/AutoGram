package com.autogram.app.features.workspace

import com.autogram.app.viewmodel.DriveFileItem
import com.autogram.app.viewmodel.TransferTaskItem
import org.junit.Assert.*
import org.junit.Test

class WorkspaceSummaryTest {
    private fun task(id: String, status: String, paused: Boolean = false, total: Long = 100, done: Long = 50) =
        TransferTaskItem(id, id, total, done, 20, 0, status, "download", paused, 0, "", "")
    private fun file(id: String, size: Long, folder: Boolean = false, modified: Long = 0) =
        DriveFileItem(id, id, size, "application/octet-stream", folder, modified)

    @Test fun emptyDataHasNoInventedUsageOrProgress() {
        val result = summarizeWorkspace(emptyList(), emptyList())
        assertEquals(0, result.fileCount)
        assertEquals(0, result.running)
        assertEquals(0L, result.knownFileBytes)
        assertEquals(0f, result.activeProgress, 0f)
        assertTrue(result.recentFiles.isEmpty())
    }

    @Test fun folderUsageExcludesFolderSizesAndDuplicates() {
        val result = summarizeWorkspace(listOf(file("a", 10), file("a", 10),
            file("folder", 999, true), file("b", -10)), emptyList())
        assertEquals(2, result.fileCount)
        assertEquals(1, result.folderCount)
        assertEquals(10L, result.knownFileBytes)
    }

    @Test fun progressAndSpeedOnlyUseActiveRows() {
        val result = summarizeWorkspace(emptyList(), listOf(
            task("a", "DOWNLOADING"), task("q", "queued", done = 0),
            task("p", "paused", paused = true, done = 0), task("done", "completed"),
            task("fail", "failed"), task("skip", "skipped"), task("cancel", "canceled")))
        assertEquals(1, result.running)
        assertEquals(1, result.queued)
        assertEquals(1, result.paused)
        assertEquals(1, result.completed)
        assertEquals(1, result.failed)
        assertEquals(1, result.skipped)
        assertEquals(1, result.cancelled)
        assertEquals(20L, result.speedBps)
        assertEquals(1f / 6f, result.activeProgress, 0.0001f)
    }

    @Test fun badSizesAndCountersCannotOverflow() {
        val result = summarizeWorkspace(listOf(file("a", Long.MAX_VALUE), file("b", 42)),
            listOf(task("a", "download", total = 10, done = 999), task("b", "queued", total = -1)))
        assertEquals(Long.MAX_VALUE, result.knownFileBytes)
        assertEquals(1f, result.activeProgress, 0f)
    }

    @Test fun recentFilesAreRealSortedAndBounded() {
        val result = summarizeWorkspace((1..8).map { file(it.toString(), 1, modified = it.toLong()) }, emptyList())
        assertEquals(listOf("8", "7", "6", "5"), result.recentFiles.map { it.id })
    }
}
