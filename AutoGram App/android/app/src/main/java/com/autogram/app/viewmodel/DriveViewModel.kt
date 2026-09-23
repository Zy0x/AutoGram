package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.autogram_android_bridge.listDriveItems

data class DriveFileItem(
    val id: String,
    val name: String,
    val size: Long,
    val mimeType: String,
    val isFolder: Boolean,
    val modifiedMs: Long,
    val thumbnailUri: String? = null,
    val deliveryKind: String = "document",
    val telegramCategory: String = "file"
)

enum class DriveMediaFilter {
    ALL,
    MEDIA,
    IMAGES,
    VIDEOS,
    AUDIO,
    DOCUMENTS,
    STICKERS
}

data class DriveUiState(
    val currentPath: String = "/",
    val searchQuery: String = "",
    val isGridView: Boolean = true,
    val mediaFilter: DriveMediaFilter = DriveMediaFilter.ALL,
    val isLoading: Boolean = false,
    val items: List<DriveFileItem> = emptyList(),
    val selectedIds: Set<String> = emptySet(),
    val sessionId: String = "",
    val peerId: String = "",
    val topicId: Long? = null,
    val errorCode: String? = null
)

class DriveViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(DriveUiState())
    val uiState: StateFlow<DriveUiState> = _uiState.asStateFlow()
    private var loadGeneration = 0L

    init {
        loadFolder("/")
    }

    fun setScope(sessionId: String, peerId: String, topicId: Long?) {
        _uiState.update {
            it.copy(sessionId = sessionId, peerId = peerId, topicId = topicId,
                currentPath = "/", items = emptyList(), selectedIds = emptySet(), searchQuery = "")
        }
        loadFolder("/")
    }

    fun loadFolder(path: String) {
        val generation = ++loadGeneration
        val scope = _uiState.value
        _uiState.update {
            it.copy(isLoading = true, currentPath = path, selectedIds = emptySet(), errorCode = null)
        }
        viewModelScope.launch {
            if (scope.sessionId.isBlank() || scope.peerId.isBlank()) {
                if (generation == loadGeneration) _uiState.update {
                    it.copy(isLoading = false, items = emptyList())
                }
                return@launch
            }
            runCatching {
                withContext(Dispatchers.IO) {
                    listDriveItems(scope.sessionId, scope.peerId, scope.topicId, path)
                }
            }.onSuccess { records ->
                if (generation != loadGeneration) return@onSuccess
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        items = records.map { record ->
                            DriveFileItem(
                                id = record.id,
                                name = record.name,
                                size = record.size.coerceAtMost(Long.MAX_VALUE.toULong()).toLong(),
                                mimeType = record.mimeType,
                                isFolder = record.isFolder,
                                modifiedMs = record.modifiedMs,
                                thumbnailUri = record.thumbnailUri,
                                deliveryKind = record.deliveryKind,
                                telegramCategory = record.telegramCategory
                            )
                        }
                    )
                }
            }.onFailure { error ->
                if (error is CancellationException) throw error
                if (generation != loadGeneration) return@onFailure
                _uiState.update {
                    it.copy(isLoading = false, items = emptyList(), errorCode = "drive_load_failed")
                }
            }
        }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun setMediaFilter(filter: DriveMediaFilter) {
        _uiState.update { it.copy(mediaFilter = filter, selectedIds = emptySet()) }
    }

    fun toggleViewMode() {
        _uiState.update { it.copy(isGridView = !it.isGridView) }
    }

    fun toggleItemSelection(id: String) {
        _uiState.update { current ->
            val updated = current.selectedIds.toMutableSet()
            if (updated.contains(id)) {
                updated.remove(id)
            } else {
                updated.add(id)
            }
            current.copy(selectedIds = updated)
        }
    }

    fun clearSelection() {
        _uiState.update { it.copy(selectedIds = emptySet()) }
    }

    fun selectAll(allItems: List<DriveFileItem>) {
        _uiState.update { it.copy(selectedIds = allItems.map { item -> item.id }.toSet()) }
    }

    fun invertSelection(allItems: List<DriveFileItem>) {
        _uiState.update { current ->
            val allIds = allItems.map { it.id }.toSet()
            val inverted = allIds - current.selectedIds
            current.copy(selectedIds = inverted)
        }
    }

    fun deleteSelected() {
        // The existing bridge only removes local rows by unscoped ID, not Telegram files.
        // Keep records intact until scoped cloud deletion is available.
        if (_uiState.value.selectedIds.isNotEmpty()) {
            _uiState.update { it.copy(errorCode = "drive_delete_unavailable") }
        }
    }
}
