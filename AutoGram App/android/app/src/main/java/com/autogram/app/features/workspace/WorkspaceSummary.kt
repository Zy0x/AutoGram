package com.autogram.app.features.workspace

import com.autogram.app.viewmodel.DriveFileItem
import com.autogram.app.viewmodel.TransferTaskItem
import java.util.Locale

data class WorkspaceSummary(
    val fileCount: Int,
    val folderCount: Int,
    val knownFileBytes: Long,
    val recentFiles: List<DriveFileItem>,
    val running: Int,
    val queued: Int,
    val paused: Int,
    val completed: Int,
    val failed: Int,
    val cancelled: Int,
    val skipped: Int,
    val activeProgress: Float,
    val speedBps: Long
)

private fun Iterable<Long>.safeSum(): Long = fold(0L) { sum, value ->
    val positive = value.coerceAtLeast(0)
    if (Long.MAX_VALUE - sum < positive) Long.MAX_VALUE else sum + positive
}

/** Drive totals describe the loaded folder only, never the entire cloud quota. */
fun summarizeWorkspace(files: List<DriveFileItem>, tasks: List<TransferTaskItem>): WorkspaceSummary {
    val uniqueFiles = files.distinctBy { it.id }
    val uniqueTasks = tasks.distinctBy { it.id }
    fun TransferTaskItem.normalizedStatus() = status.lowercase(Locale.ROOT)
    val terminal = setOf("completed", "failed", "cancelled", "canceled", "skipped")
    val active = uniqueTasks.filter { it.normalizedStatus() !in terminal }
    val running = active.filter { !it.paused && it.normalizedStatus() !in setOf("queued", "paused") }
    val total = active.sumOf { it.totalBytes.coerceAtLeast(0).toDouble() }
    val done = active.sumOf { it.transferredBytes.coerceIn(0, it.totalBytes.coerceAtLeast(0)).toDouble() }
    val leafFiles = uniqueFiles.filterNot { it.isFolder }
    return WorkspaceSummary(
        fileCount = leafFiles.size,
        folderCount = uniqueFiles.count { it.isFolder },
        knownFileBytes = leafFiles.map { it.size }.safeSum(),
        recentFiles = leafFiles.sortedWith(compareByDescending<DriveFileItem> { it.modifiedMs }.thenBy { it.id }).take(4),
        running = running.size,
        queued = active.count { !it.paused && it.normalizedStatus() == "queued" },
        paused = active.count { it.paused || it.normalizedStatus() == "paused" },
        completed = uniqueTasks.count { it.normalizedStatus() == "completed" },
        failed = uniqueTasks.count { it.normalizedStatus() == "failed" },
        cancelled = uniqueTasks.count { it.normalizedStatus() in setOf("cancelled", "canceled") },
        skipped = uniqueTasks.count { it.normalizedStatus() == "skipped" },
        activeProgress = if (total > 0) (done / total).toFloat().coerceIn(0f, 1f) else 0f,
        speedBps = running.map { it.speedBps }.safeSum()
    )
}
