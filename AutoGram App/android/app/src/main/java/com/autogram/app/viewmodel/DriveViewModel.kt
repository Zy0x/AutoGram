package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autogram.app.features.cloud.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
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
    val thumbnailBytes: ByteArray? = null,
    val topicId: Long? = null
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

enum class DriveThumbnailQuality(val wireValue: String) {
    SAVER("saver"),
    BALANCED("balanced"),
    SHARP("sharp")
}

enum class DriveGridAspectRatio(val ratio: Float, val label: String) {
    SQUARE(1f, "1:1"),
    PORTRAIT(2f / 3f, "2:3")
}

enum class DriveSortOrder {
    DATE_DESC,
    DATE_ASC,
    NAME_ASC,
    NAME_DESC,
    SIZE_DESC,
    SIZE_ASC
}

data class DriveUiState(
    val currentPath: String = "/",
    val searchQuery: String = "",
    val isGridView: Boolean = true,
    val mediaFilter: DriveMediaFilter = DriveMediaFilter.ALL,
    val thumbnailQuality: DriveThumbnailQuality = DriveThumbnailQuality.BALANCED,
    val gridAspectRatio: DriveGridAspectRatio = DriveGridAspectRatio.PORTRAIT,
    val sortOrder: DriveSortOrder = DriveSortOrder.DATE_DESC,
    val isLoading: Boolean = false,
    val items: List<DriveFileItem> = emptyList(),
    val selectedIds: Set<String> = emptySet(),
    val sessionId: String = "",
    val peerId: String = "me",
    val topicId: Long? = null,
    val isForum: Boolean = false,
    val topics: List<com.autogram.app.ui.drive.DriveTopic> = emptyList(),
    val activeTopicId: Long? = null,
    val locations: List<CloudLocation> = emptyList(),
    val activeLocationTitle: String = "Saved Messages",
    val activeLocationKind: String = "self",
    val errorCode: String? = null
)

class DriveViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(DriveUiState())
    val uiState: StateFlow<DriveUiState> = _uiState.asStateFlow()
    private val cloud = CloudStore(NativeCloudService())
    val cloudState = cloud.state
    private var mediaJob: Job? = null
    private var locationsJob: Job? = null
    private var thumbUpgradeJob: Job? = null
    private var thumbnailWorkerRevision = 0L
    private var previewActive = false
    private var pendingThumbnailIds = emptySet<Int>()
    private val upgradedIds = mutableSetOf<Int>()

    private fun stopThumbnailUpgrade() {
        thumbnailWorkerRevision++
        thumbUpgradeJob?.cancel(); thumbUpgradeJob = null
        upgradedIds.removeAll(pendingThumbnailIds); pendingThumbnailIds = emptySet()
    }

    fun setPreviewActive(active: Boolean) {
        if (previewActive == active) return
        previewActive = active
        if (active) stopThumbnailUpgrade() else triggerThumbnailUpgrade()
    }

    init {
        viewModelScope.launch {
            cloud.state.collect { result ->
                _uiState.update { current ->
                    current.copy(isLoading = result.loading, errorCode = result.error,
                        searchQuery = result.query,
                        locations = result.locations,
                        items = result.items.map { record ->
                            DriveFileItem(record.id.toString(), record.name, record.size,
                                record.mimeType, false, record.modifiedMs,
                                deliveryKind = record.deliveryKind, telegramCategory = record.telegramCategory,
                                cloudAccountId = result.scope.accountId, cloudPeerId = result.scope.peerId,
                                cloudMessageId = record.id, width = record.width, height = record.height,
                                durationSeconds = record.durationSeconds, thumbnailBytes = record.thumbnailBytes)
                        })
                }
                triggerThumbnailUpgrade()
            }
        }
    }

    private fun triggerThumbnailUpgrade() {
        if (previewActive) return
        if (cloud.state.value.loading) return
        if (thumbUpgradeJob?.isActive == true) return
        val currentQuality = _uiState.value.thumbnailQuality
        if (currentQuality == DriveThumbnailQuality.SAVER) return
        val currentItems = cloud.state.value.items
        if (currentItems.isEmpty()) return

        val eligible = currentItems.filter { item ->
            item.id > 0 &&
            (item.thumbnailBytes != null || item.telegramCategory in setOf("photo", "video", "gif", "sticker")) &&
            !upgradedIds.contains(item.id)
        }
        if (eligible.isEmpty()) return

        val revision = thumbnailWorkerRevision
        val requestScope = cloud.state.value.scope
        thumbUpgradeJob = viewModelScope.launch {
            val chunks = eligible.map { it.id }.chunked(24)
            for (chunk in chunks) {
                currentCoroutineContext().ensureActive()
                if (revision != thumbnailWorkerRevision || requestScope != cloud.state.value.scope) return@launch
                // Reserve before publication: store emissions must not schedule this batch again.
                pendingThumbnailIds = chunk.toSet()
                upgradedIds.addAll(chunk)
                cloud.upgradeThumbnails(currentQuality.wireValue, chunk)
                currentCoroutineContext().ensureActive()
                if (revision != thumbnailWorkerRevision) return@launch
                pendingThumbnailIds = emptySet()
            }
            if (revision != thumbnailWorkerRevision) return@launch
            thumbUpgradeJob = null
            triggerThumbnailUpgrade()
        }
    }

    fun setThumbnailQuality(quality: DriveThumbnailQuality) {
        if (_uiState.value.thumbnailQuality == quality) return
        stopThumbnailUpgrade()
        cloud.invalidateThumbnails()
        _uiState.update { it.copy(thumbnailQuality = quality) }
        upgradedIds.clear()
        if (quality != DriveThumbnailQuality.SAVER) {
            triggerThumbnailUpgrade()
        }
    }

    fun setScope(sessionId: String, peerId: String, topicId: Long?) {
        mediaJob?.cancel(); locationsJob?.cancel(); stopThumbnailUpgrade()
        upgradedIds.clear()
        cloud.scope(CloudScope(sessionId, peerId))
        _uiState.update {
            it.copy(sessionId = sessionId, peerId = peerId, topicId = topicId,
                currentPath = "/", items = emptyList(), selectedIds = emptySet(), searchQuery = "")
        }
        loadFolder("/")
    }

    fun loadFolder(path: String) {
        mediaJob?.cancel(); stopThumbnailUpgrade()
        upgradedIds.clear()
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

    fun chooseLocation(location: CloudLocation, context: android.content.Context? = null) {
        val isForum = location.kind == "forum"
        val loadedTopics = if (isForum && context != null) {
            com.autogram.app.ui.drive.DriveTopicsStore(context).getTopics(_uiState.value.sessionId, location.id)
        } else if (isForum) {
            listOf(com.autogram.app.ui.drive.DriveTopic(1L, "General", isClosed = false))
        } else emptyList()

        setScope(_uiState.value.sessionId, location.id, null)
        _uiState.update {
            it.copy(
                currentPath = location.title.ifEmpty { "Saved Messages" },
                activeLocationTitle = location.title.ifEmpty { "Saved Messages" },
                activeLocationKind = location.kind,
                isForum = isForum,
                topics = loadedTopics,
                activeTopicId = null
            )
        }
    }

    fun setTopicFilter(topicId: Long?) {
        _uiState.update { it.copy(activeTopicId = topicId, selectedIds = emptySet()) }
    }

    fun addTopic(title: String, colorHex: String?, iconEmoji: String?, context: android.content.Context) {
        val updated = com.autogram.app.ui.drive.DriveTopicsStore(context)
            .addTopic(_uiState.value.sessionId, _uiState.value.peerId, title, colorHex, iconEmoji)
        _uiState.update { it.copy(topics = updated) }
    }

    fun setSearchQuery(query: String) {
        stopThumbnailUpgrade(); upgradedIds.clear()
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

    fun setGridAspectRatio(ratio: DriveGridAspectRatio) {
        if (_uiState.value.gridAspectRatio == ratio) return
        _uiState.update { it.copy(gridAspectRatio = ratio) }
    }

    fun toggleGridAspectRatio() {
        val next = if (_uiState.value.gridAspectRatio == DriveGridAspectRatio.PORTRAIT) {
            DriveGridAspectRatio.SQUARE
        } else {
            DriveGridAspectRatio.PORTRAIT
        }
        setGridAspectRatio(next)
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

    fun setSortOrder(order: DriveSortOrder) {
        if (_uiState.value.sortOrder == order) return
        _uiState.update { it.copy(sortOrder = order) }
    }
}
