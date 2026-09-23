package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autogram.app.transfer.domain.TransferErrors
import com.autogram.app.transfer.domain.TransferRequestGuard
import com.autogram.app.transfer.domain.summarizeTransfers
import com.autogram.app.transfer.service.NativeTransferService
import com.autogram.app.transfer.service.TransferResult
import com.autogram.app.transfer.service.TransferService
import com.autogram.app.transfer.service.updateTransferPause
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// Keep existing screen imports compatible with the domain-owned record.
typealias TransferTaskItem = com.autogram.app.transfer.domain.TransferTaskItem

data class TransferUiState(
    val isSmartRateActive: Boolean = false,
    val activeTasks: List<TransferTaskItem> = emptyList(),
    val completedTasks: List<TransferTaskItem> = emptyList(),
    val aggregateProgress: Float = 0f,
    val isLoading: Boolean = false,
    val errorCode: String? = null
)

class TransferViewModel(
    private val transfers: TransferService = NativeTransferService()
) : ViewModel() {
    private val _uiState = MutableStateFlow(TransferUiState())
    val uiState: StateFlow<TransferUiState> = _uiState.asStateFlow()

    // Serialize native reads/writes; only the latest request may publish a snapshot.
    private val operations = Mutex()
    private val requests = TransferRequestGuard()
    private var errorRevision = 0L

    init {
        loadTransfers()
    }

    fun loadTransfers() = request(TransferErrors.LOAD_FAILED) {
        TransferResult(transfers.list())
    }

    fun pauseAll() = changePaused(paused = true)

    fun resumeAll() = changePaused(paused = false)

    fun togglePause(task: TransferTaskItem) = changePaused(taskId = task.id)

    fun cancel(@Suppress("UNUSED_PARAMETER") task: TransferTaskItem) =
        reportUnsupported(TransferErrors.CANCEL_UNSUPPORTED)

    fun cancelAll() = reportUnsupported(TransferErrors.CANCEL_UNSUPPORTED)

    fun clearCompleted() = reportUnsupported(TransferErrors.CLEAR_UNSUPPORTED)

    private fun reportUnsupported(code: String) {
        // An in-flight refresh must not erase this actionable capability error.
        errorRevision += 1
        _uiState.update { it.copy(errorCode = code) }
    }

    private fun changePaused(paused: Boolean? = null, taskId: String? = null) =
        request(TransferErrors.PAUSE_FAILED) {
            updateTransferPause(transfers, paused, taskId)
        }

    private fun request(failureCode: String, operation: suspend () -> TransferResult) {
        val requestId = requests.next()
        val revision = ++errorRevision
        _uiState.update { it.copy(isLoading = true, errorCode = null) }
        viewModelScope.launch {
            try {
                val result = operations.withLock {
                    withContext(Dispatchers.IO) { operation() }
                }
                if (!requests.isCurrent(requestId)) return@launch
                val summary = result.tasks?.let(::summarizeTransfers)
                _uiState.update {
                    it.copy(
                        activeTasks = summary?.activeTasks ?: it.activeTasks,
                        completedTasks = summary?.completedTasks ?: it.completedTasks,
                        aggregateProgress = summary?.aggregateProgress ?: it.aggregateProgress,
                        errorCode = if (revision == errorRevision) result.errorCode else it.errorCode
                    )
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: LinkageError) {
                publishError(requestId, revision, TransferErrors.NATIVE_UNAVAILABLE)
            } catch (_: Exception) {
                publishError(requestId, revision, failureCode)
            } finally {
                if (requests.isCurrent(requestId)) {
                    _uiState.update { it.copy(isLoading = false) }
                }
            }
        }
    }

    private fun publishError(requestId: Long, revision: Long, code: String) {
        if (requests.isCurrent(requestId) && revision == errorRevision) {
            _uiState.update { it.copy(errorCode = code) }
        }
    }
}
