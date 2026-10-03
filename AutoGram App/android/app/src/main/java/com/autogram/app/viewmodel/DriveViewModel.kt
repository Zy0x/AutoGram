package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autogram.app.features.cloud.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DriveFileItem(
    val id: String,
    val name: String,
    val size: Long,
    val mimeType: String,
    val isFolder: Boolean,
    val modifiedMs: Long,
    val thumbnailUri: String? = null,
    val deliveryKind: String = "document",
    val telegramCategory: String = "file",
    val cloudAccountId: String? = null,
    val cloudPeerId: String? = null,
    val cloudMessageId: Int? = null,
    val width: Int? = null,
    val height: Int? = null,
    val durationSeconds: Double? = null,
    val thumbnailBytes: ByteArray? = null
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
    private val cloud = CloudStore(NativeCloudService())
    val cloudState = cloud.state
    private var mediaJob: Job? = null
    private var locationsJob: Job? = null

    init {
        viewModelScope.launch {
            cloud.state.collect { result ->
                _uiState.update { current ->
                    current.copy(isLoading = result.loading, errorCode = result.error,
                        searchQuery = result.query,
                        items = result.items.map { record ->
                            DriveFileItem(record.id.toString(), record.name, record.size,
                                record.mimeType, false, record.modifiedMs,
                                deliveryKind = record.deliveryKind, telegramCategory = record.telegramCategory,
                                cloudAccountId = result.scope.accountId, cloudPeerId = result.scope.peerId,
                                cloudMessageId = record.id, width = record.width, height = record.height,
                                durationSeconds = record.durationSeconds, thumbnailBytes = record.thumbnailBytes)
                        })
                }
            }
        }
    }

    fun setScope(sessionId: String, peerId: String, topicId: Long?) {
        mediaJob?.cancel(); locationsJob?.cancel()
        cloud.scope(CloudScope(sessionId, peerId))
        _uiState.update {
            it.copy(sessionId = sessionId, peerId = peerId, topicId = topicId,
                currentPath = "/", items = emptyList(), selectedIds = emptySet(), searchQuery = "")
        }
        loadFolder("/")
    }

    fun loadFolder(path: String) {
        mediaJob?.cancel()
        _uiState.update { it.copy(currentPath = path, selectedIds = emptySet()) }
        mediaJob = viewModelScope.launch { cloud.media() }
    }

    fun loadMoreMedia() {
        if (cloud.state.value.loading) return
        mediaJob = viewModelScope.launch { cloud.media(append = true) }
    }

    fun loadLocations(append: Boolean = false) {
        if (append && cloud.state.value.loadingLocations) return
        locationsJob?.cancel()
        locationsJob = viewModelScope.launch { cloud.locations(append) }
    }

    fun chooseLocation(location: CloudLocation) {
        setScope(_uiState.value.sessionId, location.id, null)
        _uiState.update { it.copy(currentPath = location.title) }
    }

    fun setSearchQuery(query: String) {
        mediaJob?.cancel()
        cloud.query(query)
        _uiState.update { it.copy(searchQuery = query, items = emptyList(), selectedIds = emptySet()) }
        mediaJob = viewModelScope.launch { delay(350); cloud.media() }
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
