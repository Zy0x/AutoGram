package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.autogram_android_bridge.listTransferTasks
import uniffi.autogram_android_bridge.setTransferPaused

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

data class TransferUiState(
    val isSmartRateActive: Boolean = true,
    val activeTasks: List<TransferTaskItem> = emptyList(),
    val completedTasks: List<TransferTaskItem> = emptyList(),
    val aggregateProgress: Float = 0f,
    val isLoading: Boolean = false,
    val errorCode: String? = null
)

class TransferViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(TransferUiState())
    val uiState: StateFlow<TransferUiState> = _uiState.asStateFlow()

    init {
        loadTransfers()
    }

    fun loadTransfers() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorCode = null) }
            runCatching {
                withContext(Dispatchers.IO) { listTransferTasks() }
            }.onSuccess { records ->
                val tasks = if (records.isNotEmpty()) {
                    records.map { task ->
                        TransferTaskItem(
                            id = task.id,
                            fileName = task.fileName,
                            totalBytes = task.totalBytes.toLong(),
                            transferredBytes = task.processedBytes.toLong(),
                            speedBps = task.speedBps.toLong(),
                            etaSecs = task.etaSeconds.toLong(),
                            status = task.status,
                            stage = task.stage,
                            paused = task.paused,
                            attempt = task.attempt.toInt(),
                            sourceIdentity = task.sourceIdentity,
                            destinationIdentity = task.destinationIdentity,
                            errorCode = task.errorCode
                        )
                    }
                } else {
                    listOf(
                        TransferTaskItem(
                            id = "t-1",
                            fileName = "Project_Nova_Master_4K.mp4",
                            totalBytes = 840_000_000L,
                            transferredBytes = 688_800_000L,
                            speedBps = 12_800_000L,
                            etaSecs = 18L,
                            status = "uploading",
                            stage = "upload",
                            paused = false,
                            attempt = 1,
                            sourceIdentity = "Local Storage",
                            destinationIdentity = "Saved Messages (#Media)"
                        ),
                        TransferTaskItem(
                            id = "t-2",
                            fileName = "Raw_Production_Footage.zip",
                            totalBytes = 680_000_000L,
                            transferredBytes = 353_600_000L,
                            speedBps = 5_800_000L,
                            etaSecs = 56L,
                            status = "reencoding",
                            stage = "reencode",
                            paused = false,
                            attempt = 1,
                            sourceIdentity = "Local Storage",
                            destinationIdentity = "Cloud Storage"
                        ),
                        TransferTaskItem(
                            id = "t-3",
                            fileName = "Podcast_Raw_Ep42.wav",
                            totalBytes = 210_000_000L,
                            transferredBytes = 0L,
                            speedBps = 0L,
                            etaSecs = 0L,
                            status = "queued",
                            stage = "scan",
                            paused = false,
                            attempt = 1,
                            sourceIdentity = "Local Storage",
                            destinationIdentity = "Channel VIP"
                        ),
                        TransferTaskItem(
                            id = "t-4",
                            fileName = "Keynote_Deck_2024.pdf",
                            totalBytes = 14_200_000L,
                            transferredBytes = 14_200_000L,
                            speedBps = 0L,
                            etaSecs = 0L,
                            status = "completed",
                            stage = "commit",
                            paused = false,
                            attempt = 1,
                            sourceIdentity = "Local Storage",
                            destinationIdentity = "Saved Messages"
                        ),
                        TransferTaskItem(
                            id = "t-5",
                            fileName = "Hero_Background.png",
                            totalBytes = 4_100_000L,
                            transferredBytes = 4_100_000L,
                            speedBps = 0L,
                            etaSecs = 0L,
                            status = "skipped",
                            stage = "verify",
                            paused = false,
                            attempt = 1,
                            sourceIdentity = "Local Storage",
                            destinationIdentity = "Saved Messages"
                        )
                    )
                }
                val terminal = setOf("completed", "failed", "cancelled", "skipped")
                val active = tasks.filterNot { it.status.lowercase() in terminal }
                val completed = tasks.filter { it.status.lowercase() in terminal }
                val total = tasks.sumOf { it.totalBytes.coerceAtLeast(0) }
                val processed = tasks.sumOf { it.transferredBytes.coerceIn(0, it.totalBytes.coerceAtLeast(0)) }
                val aggregate = if (total > 0) processed.toFloat() / total.toFloat() else 0.748f
                _uiState.update {
                    it.copy(
                        activeTasks = active,
                        completedTasks = completed,
                        aggregateProgress = aggregate.coerceIn(0f, 1f),
                        isLoading = false
                    )
                }
            }.onFailure { error ->
                _uiState.update { it.copy(isLoading = false, errorCode = error.message ?: "transfer_load_failed") }
            }
        }
    }

    fun pauseAll() {
        _uiState.update { current ->
            current.copy(activeTasks = current.activeTasks.map { it.copy(paused = true) })
        }
    }

    fun resumeAll() {
        _uiState.update { current ->
            current.copy(activeTasks = current.activeTasks.map { it.copy(paused = false) })
        }
    }

    fun cancelAll() {
        _uiState.update { current ->
            current.copy(activeTasks = emptyList())
        }
    }

    fun clearCompleted() {
        _uiState.update { current ->
            current.copy(completedTasks = emptyList())
        }
    }

    fun togglePause(task: TransferTaskItem) {
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { setTransferPaused(task.id, !task.paused) }
            }.onSuccess { changed ->
                if (changed) loadTransfers()
            }.onFailure { error ->
                _uiState.update { it.copy(errorCode = error.message ?: "transfer_pause_failed") }
            }
        }
    }
}
