package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TransferTaskItem(
    val id: String,
    val fileName: String,
    val totalBytes: Long,
    val transferredBytes: Long,
    val speedBps: Long,
    val etaSecs: Long,
    val status: String
)

data class TransferUiState(
    val isSmartRateActive: Boolean = true,
    val activeTasks: List<TransferTaskItem> = emptyList(),
    val completedTasks: List<TransferTaskItem> = emptyList()
)

class TransferViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(TransferUiState())
    val uiState: StateFlow<TransferUiState> = _uiState.asStateFlow()

    init {
        loadTransfers()
    }

    private fun loadTransfers() {
        viewModelScope.launch {
            val sampleActive = listOf(
                TransferTaskItem("t1", "Video_Presentasi_FullHD.mp4", 524288000, 262144000, 12582912, 20, "Uploading"),
                TransferTaskItem("t2", "Buku_Panduan_Murid.pdf", 15728640, 7864320, 5242880, 2, "Uploading")
            )
            val sampleCompleted = listOf(
                TransferTaskItem("t3", "Arsip_Backup_Data.zip", 104857600, 104857600, 0, 0, "Completed")
            )
            _uiState.update { it.copy(activeTasks = sampleActive, completedTasks = sampleCompleted) }
        }
    }
}
