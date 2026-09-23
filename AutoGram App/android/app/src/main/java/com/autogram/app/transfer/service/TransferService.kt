package com.autogram.app.transfer.service

import com.autogram.app.transfer.domain.TransferErrors
import com.autogram.app.transfer.domain.TransferTaskItem
import com.autogram.app.transfer.domain.selectPauseChanges
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

interface TransferService {
    fun list(): List<TransferTaskItem>
    fun setPaused(id: String, paused: Boolean): Boolean
}

data class TransferResult(
    val tasks: List<TransferTaskItem>?,
    val errorCode: String? = null
)

// Caller serializes operations and runs this on Dispatchers.IO.
suspend fun updateTransferPause(
    service: TransferService,
    paused: Boolean?,
    taskId: String? = null
): TransferResult {
    val tasks = service.list()
    val changes = selectPauseChanges(tasks, paused, taskId)
    var errorCode: String? = if (taskId != null && changes.isEmpty()) {
        TransferErrors.PAUSE_FAILED
    } else null
    for (change in changes) {
        currentCoroutineContext().ensureActive()
        try {
            if (!service.setPaused(change.id, change.paused)) {
                errorCode = TransferErrors.PAUSE_FAILED
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: LinkageError) {
            errorCode = TransferErrors.NATIVE_UNAVAILABLE
            break
        } catch (_: Exception) {
            errorCode = TransferErrors.PAUSE_FAILED
        }
    }
    currentCoroutineContext().ensureActive()
    // Re-read even after partial failure: only native-confirmed state is presented.
    return try {
        TransferResult(service.list(), errorCode)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: LinkageError) {
        TransferResult(null, TransferErrors.NATIVE_UNAVAILABLE)
    } catch (_: Exception) {
        TransferResult(null, errorCode ?: TransferErrors.LOAD_FAILED)
    }
}
