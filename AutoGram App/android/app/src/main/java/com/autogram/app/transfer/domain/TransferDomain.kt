package com.autogram.app.transfer.domain

data class TransferTaskItem(
    val id: String,
    val fileName: String,
    val totalBytes: Long,
    val transferredBytes: Long,
    val speedBps: Long,
    val etaSecs: Long,
    val status: String,
    val stage: String,
    val paused: Boolean,
    val attempt: Int,
    val sourceIdentity: String,
    val destinationIdentity: String,
    val errorCode: String? = null
)

object TransferErrors {
    const val LOAD_FAILED = "transfer_load_failed"
    const val PAUSE_FAILED = "transfer_pause_failed"
    const val NATIVE_UNAVAILABLE = "transfer_native_unavailable"
    const val CANCEL_UNSUPPORTED = "transfer_cancel_unsupported"
    const val CLEAR_UNSUPPORTED = "transfer_clear_completed_unsupported"
}

data class TransferSummary(
    val activeTasks: List<TransferTaskItem>,
    val completedTasks: List<TransferTaskItem>,
    val aggregateProgress: Float
)

private val terminalStatuses = setOf("completed", "failed", "cancelled", "canceled", "skipped")

fun TransferTaskItem.isTerminal(): Boolean = status.lowercase() in terminalStatuses

fun summarizeTransfers(tasks: List<TransferTaskItem>): TransferSummary {
    val (completed, active) = tasks.partition { it.isTerminal() }
    // Sum as doubles so a large queue cannot overflow a signed byte counter.
    val total = tasks.sumOf { it.totalBytes.coerceAtLeast(0).toDouble() }
    val processed = tasks.sumOf {
        it.transferredBytes.coerceIn(0, it.totalBytes.coerceAtLeast(0)).toDouble()
    }
    val progress = if (total > 0) (processed / total).toFloat().coerceIn(0f, 1f) else 0f
    return TransferSummary(active, completed, progress)
}

data class TransferPauseChange(val id: String, val paused: Boolean)

// A null desired state toggles one task using its freshly loaded native state.
fun selectPauseChanges(
    tasks: List<TransferTaskItem>,
    paused: Boolean?,
    taskId: String? = null
): List<TransferPauseChange> {
    require(paused != null || taskId != null)
    return tasks.asSequence()
        .filter { !it.isTerminal() && (taskId == null || it.id == taskId) }
        .mapNotNull { task ->
            val currentlyPaused = task.paused || task.status.equals("paused", ignoreCase = true)
            val desired = paused ?: !currentlyPaused
            if (desired == currentlyPaused) null else TransferPauseChange(task.id, desired)
        }
        .distinctBy { it.id }
        .toList()
}

// Accessed only on the view model's main thread; native work never touches it.
class TransferRequestGuard {
    private var generation = 0L

    fun next(): Long = ++generation

    fun isCurrent(request: Long): Boolean = request == generation
}
