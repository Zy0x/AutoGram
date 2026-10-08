package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autogram.app.features.cloud.*
import com.autogram.app.features.cloud.reads.CloudReadCoalescer
import com.autogram.app.features.cloud.reads.CloudAutomaticRetryBudget
import com.autogram.app.features.cloud.topics.CloudTopic
import com.autogram.app.features.cloud.topics.currentDriveLocation
import com.autogram.app.features.cloud.topics.resolveDriveLocation
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
    val topics: List<CloudTopic> = emptyList(),
    val activeTopicId: Long? = null,
    val locations: List<CloudLocation> = emptyList(),
    val activeLocationTitle: String = "",
    val activeLocationKind: String = "self",
    val errorCode: String? = null
)

class DriveViewModel(
    cloudService: CloudService = NativeCloudService(),
    topicsService: com.autogram.app.features.cloud.topics.CloudTopicsService = NativeCloudService(),
    avatarService: com.autogram.app.features.cloud.avatars.CloudAvatarService = NativeCloudService()
) : ViewModel() {

    private val _uiState = MutableStateFlow(DriveUiState())
    val uiState: StateFlow<DriveUiState> = _uiState.asStateFlow()
    private val cloud = CloudStore(cloudService)
    private val topics = com.autogram.app.features.cloud.topics.CloudTopicsStore(topicsService)
    val topicsState = topics.state
    private val topicReads = CloudReadCoalescer(viewModelScope)
    val cloudState = cloud.state
    private val avatars = com.autogram.app.features.cloud.avatars.CloudAvatarStore(avatarService)
    val avatarState = avatars.state
    private val avatarJobs = mutableSetOf<Job>()
    fun loadAvatar(accountId: String, location: CloudLocation) {
        if (accountId != avatars.state.value.accountId) return
        val job = viewModelScope.launch { avatars.load(accountId, location) }
        avatarJobs.removeAll { it.isCompleted }
        avatarJobs.add(job)
    }
    private val mediaReads = CloudReadCoalescer(viewModelScope)
    private var locationsJob: Job? = null
    private var thumbUpgradeJob: Job? = null
    private var thumbnailWorkerRevision = 0L
    private var previewActive = false
    private var pendingThumbnailIds = emptySet<Int>()
    private val upgradedIds = mutableSetOf<Int>()
    private var visibleMediaIds = emptySet<Int>()
    private var galleryScrolling = false
    private val mediaRecovery = CloudAutomaticRetryBudget()
    private val topicRecovery = CloudAutomaticRetryBudget()
    private val thumbnailRecovery = CloudAutomaticRetryBudget()
    private val failedThumbnailIds = mutableSetOf<Int>()
    private var mediaRetryAppend = false
    private var topicRetryAppend = false

    private fun resetMediaIntent() {
        mediaRecovery.reset(); thumbnailRecovery.reset()
        failedThumbnailIds.clear(); mediaRetryAppend = false
    }

    fun resumeMediaAfterWait() {
        if (mediaReads.isActive || cloud.state.value.loading || !mediaRecovery.take()) return
        val append = mediaRetryAppend
        mediaReads.submit(settleMs = 0) { cloud.media(append, preferCache = !append) }
    }

    fun resumeTopicsAfterWait() {
        if (topicReads.isActive || topics.state.value.loading || !topicRecovery.take()) return
        val append = topicRetryAppend
        topicReads.submit(settleMs = 0) { topics.load(append, preferCache = !append) }
    }

    fun setVisibleMedia(ids: List<Int>, scrolling: Boolean) {
        visibleMediaIds = ids.toSet()
        if (galleryScrolling != scrolling || scrolling || ids.isEmpty()) stopThumbnailUpgrade()
        galleryScrolling = scrolling
        if (!scrolling) triggerThumbnailUpgrade()
    }

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

    private fun mediaItems(result: CloudState) = result.items.map { record ->
        DriveFileItem(record.id.toString(), record.name, record.size, record.mimeType,
            false, record.modifiedMs, deliveryKind = record.deliveryKind,
            telegramCategory = record.telegramCategory, cloudAccountId = result.scope.accountId,
            cloudPeerId = result.scope.peerId, cloudMessageId = record.id, width = record.width,
            height = record.height, durationSeconds = record.durationSeconds,
            thumbnailBytes = record.thumbnailBytes, topicId = record.topicId)
    }

    init {
        viewModelScope.launch {
            cloud.state.collect { result ->
                val before = _uiState.value
                _uiState.update { current ->
                    if (current.sessionId != result.scope.accountId || current.peerId != result.scope.peerId ||
                        current.topicId != result.scope.topicId) return@update current
                    val location = currentDriveLocation(current.peerId, result.locations)
                    current.copy(isLoading = result.loading, errorCode = result.error,
                        searchQuery = result.query,
                        locations = result.locations,
                        activeLocationTitle = location?.title ?: current.activeLocationTitle,
                        activeLocationKind = location?.kind ?: current.activeLocationKind,
                        isForum = location?.let { it.kind == "forum" } ?: current.isForum,
                        items = mediaItems(result))
                }
                if (_uiState.value.isForum && (!before.isForum ||
                    (topics.state.value.error == "cloud_location_missing" &&
                        currentDriveLocation(_uiState.value.peerId, result.locations) != null))) loadTopics(refresh = false)
                triggerThumbnailUpgrade()
            }
        }
        viewModelScope.launch {
            topics.state.collect { result ->
                _uiState.update { current ->
                    if (current.sessionId == result.scope.accountId && current.peerId == result.scope.peerId)
                        current.copy(topics = result.items) else current
                }
            }
        }
    }

    private fun triggerThumbnailUpgrade() {
        if (previewActive || galleryScrolling || visibleMediaIds.isEmpty()) return
        if (cloud.state.value.loading) return
        if (thumbUpgradeJob?.isActive == true) return
        val currentQuality = _uiState.value.thumbnailQuality
        if (currentQuality == DriveThumbnailQuality.SAVER) return
        val currentItems = cloud.state.value.items
        if (currentItems.isEmpty()) return

        val eligible = currentItems.filter { item ->
            item.id > 0 &&
            (item.thumbnailBytes != null || item.telegramCategory in setOf("photo", "video", "gif", "sticker")) &&
            item.id in visibleMediaIds && item.id !in failedThumbnailIds && !upgradedIds.contains(item.id)
        }
        if (eligible.isEmpty()) return

        val revision = thumbnailWorkerRevision
        val requestScope = cloud.state.value.scope
        thumbUpgradeJob = viewModelScope.launch {
            // Optional work starts only after the viewport/selection settles; never warm a whole page.
            delay(600)
            val chunks = eligible.map { it.id }.chunked(4)
            for (chunk in chunks) {
                currentCoroutineContext().ensureActive()
                if (revision != thumbnailWorkerRevision || requestScope != cloud.state.value.scope) return@launch
                if (galleryScrolling || chunk.none { it in visibleMediaIds }) continue
                val visibleChunk = chunk.filter { it in visibleMediaIds }
                // Reserve before publication: store emissions must not schedule this batch again.
                pendingThumbnailIds = visibleChunk.toSet()
                upgradedIds.addAll(visibleChunk)
                val completed = cloud.upgradeThumbnails(currentQuality.wireValue, visibleChunk)
                currentCoroutineContext().ensureActive()
                if (revision != thumbnailWorkerRevision) return@launch
                pendingThumbnailIds = emptySet()
                if (!completed) {
                    upgradedIds.removeAll(visibleChunk)
                    failedThumbnailIds.addAll(visibleChunk)
                    val retryAt = cloud.state.value.thumbnailRetryAtMs
                    val waitForServer = retryAt > System.currentTimeMillis() && thumbnailRecovery.take()
                    if (waitForServer) delay((retryAt - System.currentTimeMillis()).coerceAtLeast(0))
                    thumbUpgradeJob = null
                    if (waitForServer) {
                        failedThumbnailIds.removeAll(visibleChunk)
                        triggerThumbnailUpgrade()
                    }
                    return@launch
                }
                delay(150)
            }
            if (revision != thumbnailWorkerRevision) return@launch
            thumbUpgradeJob = null
            triggerThumbnailUpgrade()
        }
    }

    fun setThumbnailQuality(quality: DriveThumbnailQuality) {
        if (_uiState.value.thumbnailQuality == quality) return
        stopThumbnailUpgrade()
        thumbnailRecovery.reset(); failedThumbnailIds.clear()
        cloud.invalidateThumbnails()
        _uiState.update { it.copy(thumbnailQuality = quality) }
        upgradedIds.clear()
        if (quality != DriveThumbnailQuality.SAVER) {
            triggerThumbnailUpgrade()
        }
    }

    fun setScope(sessionId: String, peerId: String, topicId: Long?) {
        resetMediaIntent(); topicRecovery.reset(); topicRetryAppend = false
        if (sessionId != avatars.state.value.accountId) {
            avatarJobs.forEach { it.cancel() }; avatarJobs.clear()
        }
        avatars.scope(sessionId)
        val location = if (sessionId == cloud.state.value.scope.accountId)
            currentDriveLocation(peerId, cloud.state.value.locations)
                ?: currentDriveLocation(peerId, _uiState.value.locations)
        else null
        mediaReads.cancel(); stopThumbnailUpgrade(); visibleMediaIds = emptySet()
        if (sessionId != cloud.state.value.scope.accountId) locationsJob?.cancel()
        upgradedIds.clear()
        topicReads.cancel()
        topics.scope(CloudScope(sessionId, peerId))
        cloud.scope(CloudScope(sessionId, peerId, topicId))
        // StateFlow can publish before this UI scope update, or suppress an identical cache hit.
        // Restore the confirmed snapshot directly instead of relying on a second emission.
        val restored = cloud.state.value
        _uiState.update {
            it.copy(sessionId = sessionId, peerId = peerId, topicId = topicId,
                currentPath = "/", items = mediaItems(restored), isLoading = restored.loading,
                selectedIds = emptySet(), searchQuery = "",
                locations = cloud.state.value.locations, errorCode = cloud.state.value.error,
                topics = topics.state.value.items, activeTopicId = topicId, isForum = location?.kind == "forum",
                activeLocationTitle = location?.title.orEmpty(), activeLocationKind = location?.kind ?: "self")
        }
        mediaReads.submit { cloud.media(preferCache = true) }
        if (_uiState.value.isForum) loadTopics(refresh = false)
    }

    fun loadFolder(path: String) {
        resetMediaIntent()
        mediaReads.cancel(); stopThumbnailUpgrade()
        upgradedIds.clear()
        _uiState.update { it.copy(currentPath = path, selectedIds = emptySet()) }
        mediaReads.submit(settleMs = 0) { cloud.media() }
    }

    fun loadMoreMedia() {
        if (cloud.state.value.loading || mediaReads.isActive) return
        mediaRecovery.reset(); mediaRetryAppend = true
        mediaReads.submit(settleMs = 0) { cloud.media(append = true) }
    }

    fun loadLocations(append: Boolean = false, refresh: Boolean = true) {
        if (cloud.state.value.loadingLocations) return
        if (!append && !refresh && cloud.state.value.locations.isNotEmpty()) return
        locationsJob?.cancel()
        locationsJob = viewModelScope.launch { cloud.locations(append) }
    }

    fun chooseLocation(location: CloudLocation) {
        if (_uiState.value.peerId == location.id && _uiState.value.topicId == null) return
        val resolved = resolveDriveLocation(location, _uiState.value.locations)
        val isForum = resolved.kind == "forum"

        setScope(_uiState.value.sessionId, resolved.id, null)
        _uiState.update {
            it.copy(
                currentPath = resolved.title.ifEmpty { "/" },
                activeLocationTitle = resolved.title,
                activeLocationKind = resolved.kind,
                isForum = isForum,
                activeTopicId = null
            )
        }
        if (isForum && !topicReads.isActive && !topics.state.value.loading) {
            loadTopics(refresh = false)
        }
    }

    fun loadTopics(append: Boolean = false, refresh: Boolean = true) {
        if (!_uiState.value.isForum || topicReads.isActive || topics.state.value.loading) return
        if (refresh) topicRecovery.reset()
        topicRetryAppend = append
        topicReads.submit(settleMs = if (refresh) 0 else 240) { topics.load(append, preferCache = !refresh) }
    }

    fun setTopicFilter(topicId: Long?) {
        val current = _uiState.value
        if (topicId == current.activeTopicId) return
        if (topicId != null && current.topics.none { it.id == topicId }) return
        resetMediaIntent()
        mediaReads.cancel(); stopThumbnailUpgrade(); upgradedIds.clear(); visibleMediaIds = emptySet()
        cloud.scope(CloudScope(current.sessionId, current.peerId, topicId))
        _uiState.update { it.copy(activeTopicId = topicId, topicId = topicId,
            items = mediaItems(cloud.state.value), isLoading = cloud.state.value.loading,
            errorCode = cloud.state.value.error, selectedIds = emptySet(), searchQuery = "") }
        mediaReads.submit { cloud.media(preferCache = true) }
    }

    fun setSearchQuery(query: String) {
        if (query == _uiState.value.searchQuery) return
        resetMediaIntent()
        stopThumbnailUpgrade(); upgradedIds.clear()
        mediaReads.cancel()
        cloud.query(query)
        _uiState.update { it.copy(searchQuery = query, items = emptyList(), selectedIds = emptySet()) }
        mediaReads.submit(settleMs = 350) { cloud.media(preferCache = true) }
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
