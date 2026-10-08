package com.autogram.app.ui.drive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramEmptyState
import com.autogram.app.ui.components.AutoGramErrorState
import com.autogram.app.ui.components.AutoGramSurface
import com.autogram.app.viewmodel.*
import com.autogram.app.features.workspace.UnavailableOperationDialog
import com.autogram.app.ui.drive.gallery.*
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import java.util.Date
import androidx.compose.ui.platform.testTag
import com.autogram.app.features.cloud.cloudErrorLabel
import com.autogram.app.features.cloudtransfer.DownloadPanel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun childPath(base: String, name: String): String =
    if (base == "/" || base.isBlank()) "/$name" else "${base.trimEnd('/')}/$name"

@Composable
fun DriveScreen(
    viewModel: DriveViewModel,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val state by viewModel.uiState.collectAsState()
    val cloudState by viewModel.cloudState.collectAsState()
    val topicsState by viewModel.topicsState.collectAsState()
    val avatars by viewModel.avatarState.collectAsState()
    var previewItem by remember { mutableStateOf<DriveFileItem?>(null) }
    var zipArchiveItem by remember { mutableStateOf<DriveFileItem?>(null) }
    var isDriveToolsOpen by remember { mutableStateOf(false) }
    var isRemoteUploadOpen by remember { mutableStateOf(false) }
    var isDedupCleanerOpen by remember { mutableStateOf(false) }
    var isDestinationModalOpen by remember { mutableStateOf(false) }
    var isTagModalOpen by remember { mutableStateOf(false) }
    var isMoveModalOpen by remember { mutableStateOf(false) }
    var isDeleteModalOpen by remember { mutableStateOf(false) }
    var isLocationPickerOpen by remember { mutableStateOf(false) }
    var isCreateTopicOpen by remember { mutableStateOf(false) }
    var isCustomizeIconOpen by remember { mutableStateOf(false) }
    var isViewOptionsOpen by remember { mutableStateOf(false) }
    var isTopicHubOpen by remember { mutableStateOf(false) }
    var unsupported by remember { mutableStateOf(false) }
    var isDownloadsOpen by remember(state.sessionId) { mutableStateOf(false) }
    var downloadItem by remember { mutableStateOf<DriveFileItem?>(null) }
    LaunchedEffect(previewItem != null || zipArchiveItem != null) {
        viewModel.setPreviewActive(previewItem != null || zipArchiveItem != null)
    }
    DisposableEffect(viewModel) {
        onDispose { viewModel.setPreviewActive(false) }
    }
    LaunchedEffect(state.sessionId, state.peerId, state.topicId) {
        previewItem = null
        zipArchiveItem = null
        isLocationPickerOpen = false
        isCreateTopicOpen = false
        isCustomizeIconOpen = false
        isViewOptionsOpen = false
        isTopicHubOpen = false
        isDriveToolsOpen = false
        isRemoteUploadOpen = false
        isDedupCleanerOpen = false
        isDestinationModalOpen = false
        isTagModalOpen = false
        isMoveModalOpen = false
        isDeleteModalOpen = false
    }

    LaunchedEffect(state.sessionId) {
        if (state.sessionId.isNotBlank()) viewModel.loadLocations(refresh = false)
    }
    LaunchedEffect(state.sessionId, state.peerId, state.topicId, cloudState.error, cloudState.retryAtMs) {
        if (cloudState.error == "flood_wait" && cloudState.retryAtMs > 0) {
            kotlinx.coroutines.delay((cloudState.retryAtMs - System.currentTimeMillis()).coerceAtLeast(100))
            viewModel.resumeMediaAfterWait()
        }
    }
    LaunchedEffect(state.sessionId, state.peerId, topicsState.error, topicsState.retryAtMs) {
        if (topicsState.error == "flood_wait" && topicsState.retryAtMs > 0) {
            kotlinx.coroutines.delay((topicsState.retryAtMs - System.currentTimeMillis()).coerceAtLeast(100))
            viewModel.resumeTopicsAfterWait()
        }
    }

    DriveScreenContent(
        state = state,
        modifier = modifier,
        onSearchChange = viewModel::setSearchQuery,
        onMediaFilterChange = viewModel::setMediaFilter,
        onVisibleMedia = viewModel::setVisibleMedia,
        onOpenLocationPicker = { isLocationPickerOpen = true },
        onTopicSelect = viewModel::setTopicFilter,
        onOpenViewOptions = { isViewOptionsOpen = true },
        onOpenTopicHub = { isTopicHubOpen = true },
        sortOrder = state.sortOrder,
        onSortOrderChange = viewModel::setSortOrder,
        onThumbnailQualityChange = viewModel::setThumbnailQuality,
        onGridAspectRatioChange = viewModel::setGridAspectRatio,
        onToggleViewMode = viewModel::toggleViewMode,
        onRefresh = { viewModel.loadFolder(state.currentPath) },
        onUpload = { unsupported = true },
        onRemoteUpload = { isRemoteUploadOpen = true },
        onClearSelection = viewModel::clearSelection,
        onSelectAll = { viewModel.selectAll(galleryItems(state.items, state.searchQuery, state.mediaFilter, state.activeTopicId)) },
        onInvertSelection = { viewModel.invertSelection(galleryItems(state.items, state.searchQuery, state.mediaFilter, state.activeTopicId)) },
        onDownloadZip = {
            val selectedItems = state.items.filter { it.id in state.selectedIds }
            if (selectedItems.isNotEmpty() && state.sessionId.isNotBlank()) {
                val queue = com.autogram.app.features.cloudtransfer.services.NativeDownloadQueue
                val presentation = com.autogram.app.features.cloudtransfer.DownloadPresentationStore(context)
                coroutineScope.launch(Dispatchers.IO) {
                    selectedItems.forEach { item ->
                        if (item.cloudPeerId != null && item.cloudMessageId != null) {
                            try {
                                val op = queue.enqueue(state.sessionId, item.cloudPeerId, item.cloudMessageId)
                                presentation.put(state.sessionId, op, item.name, item.mimeType)
                            } catch (_: Exception) {}
                        }
                    }
                    withContext(Dispatchers.Main) {
                        queue.wake(context)
                        android.widget.Toast.makeText(
                            context,
                            context.getString(R.string.drive_download_batch_started, selectedItems.size),
                            android.widget.Toast.LENGTH_SHORT
                        ).show()
                        viewModel.clearSelection()
                    }
                }
            }
        },
        onCleanForward = { isDestinationModalOpen = true },
        onMoveFolder = { isMoveModalOpen = true },
        onCopyLinks = {
            val selectedItems = state.items.filter { it.id in state.selectedIds }
            if (selectedItems.isNotEmpty()) {
                val links = selectedItems.joinToString("\n") { item ->
                    if (item.cloudPeerId != null && item.cloudMessageId != null) {
                        "https://t.me/c/${item.cloudPeerId.trimStart('-')}/${item.cloudMessageId}"
                    } else {
                        item.name
                    }
                }
                val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                val clip = android.content.ClipData.newPlainText("Telegram Links", links)
                clipboard?.setPrimaryClip(clip)
                android.widget.Toast.makeText(
                    context,
                    context.getString(R.string.drive_links_copied, selectedItems.size),
                    android.widget.Toast.LENGTH_SHORT
                ).show()
                viewModel.clearSelection()
            }
        },
        onTagCategory = { isTagModalOpen = true },
        onDeleteSelected = { isDeleteModalOpen = true },
        onOpenTools = { isDriveToolsOpen = true },
        onAddTopic = { isCreateTopicOpen = true },
        onCustomizeIcon = { isCustomizeIconOpen = true },
        onItemClick = { item ->
            if (state.selectedIds.isNotEmpty()) {
                viewModel.toggleItemSelection(item.id)
            } else if (item.isFolder) {
                viewModel.loadFolder(childPath(state.currentPath, item.name))
            } else if (item.name.endsWith(".zip", ignoreCase = true)) {
                zipArchiveItem = item
            } else {
                previewItem = item
            }
        },
        onItemLongClick = { item -> viewModel.toggleItemSelection(item.id) },
        onOpenDownloads = { isDownloadsOpen = true },
        cloudControls = { DownloadPanel(state.sessionId, downloadItem, { downloadItem = null },
            showLauncher = false, openRequested = isDownloadsOpen,
            onOpenRequestConsumed = { isDownloadsOpen = false }) },
        storyControls = { compact -> DriveStories(cloudState, { append -> viewModel.loadLocations(append) }, viewModel::chooseLocation, compact = compact,
            avatars = avatars, onAvatar = viewModel::loadAvatar) },
        topicsLoading = topicsState.loading,
        topicsError = topicsState.error,
        onRetryTopics = { viewModel.loadTopics() },
        pagingControls = {
            if (cloudState.nextOffset != null) TextButton(onClick = viewModel::loadMoreMedia, enabled = !cloudState.loading) {
                Text(stringResource(R.string.cloud_more))
            }
        }
    )

    // Modals
    val currentPreview = previewItem
    if (currentPreview != null) {
        DrivePreviewModal(
            item = currentPreview,
            allItems = com.autogram.app.ui.drive.preview.previewNavigationItems(state, currentPreview),
            onDismiss = { previewItem = null },
            onNavigateItem = { previewItem = it },
            onDownload = { downloadItem = it; previewItem = null }
        )
    }

    val currentZip = zipArchiveItem
    if (currentZip != null) {
        ZipExplorerModal(
            archiveItem = currentZip,
            onDismiss = { zipArchiveItem = null }
        )
    }

    if (isDriveToolsOpen) {
        DriveToolsSheet(
            items = state.items,
            locationTitle = state.activeLocationTitle.ifEmpty { stringResource(R.string.cloud_saved_messages) },
            onDismiss = { isDriveToolsOpen = false },
            onDeleteItems = { toDeleteIds ->
                toDeleteIds.forEach { viewModel.toggleItemSelection(it) }
                isDeleteModalOpen = true
            }
        )
    }

    if (isDedupCleanerOpen) {
        DriveDuplicateCleanerSheet(
            items = state.items,
            onDismiss = { isDedupCleanerOpen = false },
            onCleanDuplicates = { unsupported = true }
        )
    }

    if (isRemoteUploadOpen) {
        DriveRemoteUploadModal(
            currentFolder = state.currentPath,
            onDismiss = { isRemoteUploadOpen = false },
            onSubmitUrl = { _, _, _ -> unsupported = true }
        )
    }

    if (isDestinationModalOpen) {
        DriveChatDestinationModal(
            selectedCount = state.selectedIds.size.coerceAtLeast(1),
            locations = cloudState.locations,
            sessionId = state.sessionId,
            onForward = { _, _, _ -> unsupported = true },
            onDismiss = { isDestinationModalOpen = false }
        )
    }

    if (isCreateTopicOpen) {
        DriveCreateTopicModal(
            onDismiss = { isCreateTopicOpen = false },
            onCreateTopic = { _, _, _ -> unsupported = true }
        )
    }

    if (isCustomizeIconOpen) {
        DriveCustomizeIconModal(
            peerId = state.peerId,
            title = state.activeLocationTitle.ifEmpty { stringResource(R.string.cloud_saved_messages) },
            kind = state.activeLocationKind,
            isForum = state.isForum,
            onDismiss = { isCustomizeIconOpen = false },
            onSaved = { isCustomizeIconOpen = false }
        )
    }

    if (isTagModalOpen) {
        DriveTagCategoryModal(
            selectedCount = state.selectedIds.size.coerceAtLeast(1),
            onApply = { _, _ -> unsupported = true },
            onDismiss = { isTagModalOpen = false }
        )
    }

    if (isMoveModalOpen) {
        DriveMoveFolderModal(
            selectedCount = state.selectedIds.size.coerceAtLeast(1),
            currentPath = state.currentPath,
            onMove = { _ -> unsupported = true },
            onDismiss = { isMoveModalOpen = false }
        )
    }

    if (isDeleteModalOpen) {
        DriveConfirmDeleteModal(
            selectedCount = state.selectedIds.size.coerceAtLeast(1),
            onConfirm = { unsupported = true },
            onDismiss = { isDeleteModalOpen = false }
        )
    }

    if (isLocationPickerOpen) {
        DriveLocationPickerSheet(
            currentPeerId = state.peerId,
            locations = state.locations,
            sessionId = state.sessionId,
            onSelectLocation = { location ->
                viewModel.chooseLocation(location)
                isLocationPickerOpen = false
            },
            onDismiss = { isLocationPickerOpen = false }
        )
    }

    if (isViewOptionsOpen) {
        DriveViewOptionsSheet(
            isGridView = state.isGridView,
            onToggleViewMode = viewModel::toggleViewMode,
            gridAspectRatio = state.gridAspectRatio,
            onGridAspectRatioChange = viewModel::setGridAspectRatio,
            thumbnailQuality = state.thumbnailQuality,
            onThumbnailQualityChange = viewModel::setThumbnailQuality,
            sortOrder = state.sortOrder,
            onSortOrderChange = viewModel::setSortOrder,
            onDismiss = { isViewOptionsOpen = false }
        )
    }

    if (isTopicHubOpen) {
        DriveTopicHubSheet(
            topics = state.topics,
            activeTopicId = state.activeTopicId,
            onSelectTopic = viewModel::setTopicFilter,
            onAddTopic = { isCreateTopicOpen = true },
            onDismiss = { isTopicHubOpen = false },
            loading = topicsState.loading, error = topicsState.error,
            hasMore = topicsState.next != null,
            onRefresh = { viewModel.loadTopics() }, onMore = { viewModel.loadTopics(true) }
        )
    }

    if (unsupported) UnavailableOperationDialog({ unsupported = false })
}

@Composable
fun DriveScreenContent(
    state: DriveUiState,
    modifier: Modifier = Modifier,
    onSearchChange: (String) -> Unit,
    onMediaFilterChange: (DriveMediaFilter) -> Unit,
    onOpenLocationPicker: () -> Unit = {},
    onTopicSelect: (Long?) -> Unit = {},
    onOpenViewOptions: () -> Unit = {},
    onOpenTopicHub: () -> Unit = {},
    sortOrder: DriveSortOrder = DriveSortOrder.DATE_DESC,
    onSortOrderChange: (DriveSortOrder) -> Unit = {},
    onThumbnailQualityChange: (DriveThumbnailQuality) -> Unit = {},
    onGridAspectRatioChange: (DriveGridAspectRatio) -> Unit = {},
    onToggleViewMode: () -> Unit,
    onRefresh: () -> Unit,
    onUpload: () -> Unit,
    onRemoteUpload: () -> Unit = {},
    onClearSelection: () -> Unit,
    onSelectAll: () -> Unit,
    onInvertSelection: () -> Unit,
    onDownloadZip: () -> Unit,
    onCleanForward: () -> Unit,
    onMoveFolder: () -> Unit,
    onCopyLinks: () -> Unit,
    onTagCategory: () -> Unit,
    onDeleteSelected: () -> Unit,
    onOpenTools: () -> Unit,
    onAddTopic: () -> Unit = {},
    onCustomizeIcon: () -> Unit = {},
    onItemClick: (DriveFileItem) -> Unit,
    onItemLongClick: (DriveFileItem) -> Unit,
    cloudControls: (@Composable () -> Unit)? = null,
    storyControls: (@Composable (Boolean) -> Unit)? = null,
    pagingControls: (@Composable () -> Unit)? = null,
    onOpenDownloads: () -> Unit = {},
    topicsLoading: Boolean = false,
    topicsError: String? = null,
    onRetryTopics: () -> Unit = {},
    onVisibleMedia: (List<Int>, Boolean) -> Unit = { _, _ -> }
) {
    val filteredItems = remember(state.items, state.searchQuery, state.mediaFilter, state.activeTopicId) {
        galleryItems(state.items, state.searchQuery, state.mediaFilter, state.activeTopicId)
    }
    val sections = remember(filteredItems) { gallerySections(filteredItems) }
    val context = LocalContext.current
    val gridState = rememberLazyGridState()
    val visibleCallback by rememberUpdatedState(onVisibleMedia)
    LaunchedEffect(gridState, state.sessionId, state.peerId, state.activeTopicId) {
        snapshotFlow {
            gridState.layoutInfo.visibleItemsInfo.mapNotNull { cell ->
                (cell.key as? String)?.takeIf { it.startsWith("media:") }?.removePrefix("media:")?.toIntOrNull()
            } to gridState.isScrollInProgress
        }.collect { (ids, scrolling) -> visibleCallback(ids, scrolling) }
    }
    DisposableEffect(state.sessionId, state.peerId, state.activeTopicId) {
        onDispose { visibleCallback(emptyList(), false) }
    }
    val collapseOffset = with(LocalDensity.current) { 48.dp.roundToPx() }
    val compact by remember(gridState, collapseOffset) {
        derivedStateOf { gridState.firstVisibleItemIndex > 0 || gridState.firstVisibleItemScrollOffset > collapseOffset }
    }
    // Typing must not repeatedly move/dispose a focused virtualized search field.
    LaunchedEffect(state.sessionId, state.peerId, state.mediaFilter, state.activeTopicId) { gridState.scrollToItem(0) }

    AutoGramSurface(modifier) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Unified Header (Location, Search, Tune, More) / Selection Mode
                val header: @Composable (Boolean, (@Composable () -> Unit)?) -> Unit = { collapsed, rail -> DriveUnifiedHeader(
                    selectedCount = state.selectedIds.size,
                    activeLocationTitle = state.activeLocationTitle,
                    activeLocationKind = state.activeLocationKind,
                    activeLocationPeerId = state.peerId,
                    isForum = state.isForum,
                    onOpenLocationPicker = onOpenLocationPicker,
                    searchQuery = state.searchQuery,
                    onSearchChange = onSearchChange,
                    onOpenViewOptions = onOpenViewOptions,
                    onRefresh = onRefresh,
                    onOpenTools = onOpenTools,
                    onCustomizeIcon = onCustomizeIcon,
                    onClearSelection = onClearSelection,
                    onSelectAll = onSelectAll,
                    onInvertSelection = onInvertSelection,
                    onDownloadZip = onDownloadZip,
                    onCopyLinks = onCopyLinks,
                    onOpenDownloads = onOpenDownloads,
                    compact = collapsed,
                    locations = rail
                ) }
                DrivePinnedNavigation(compact, state.selectedIds.isNotEmpty(), storyControls, header,
                    if (state.isForum) ({ key(state.sessionId, state.peerId) { DriveForumTopicStrip(state.topics, state.activeTopicId,
                        onTopicSelect, onOpenTopicHub, loading = topicsLoading, error = topicsError,
                        onRetry = onRetryTopics) } }) else null)

                // Active Download panel / Cloud controls if mounted
                cloudControls?.invoke()

                // Error State if any
                state.errorCode?.let { code ->
                    AutoGramErrorState(stringResource(cloudErrorLabel(code)), onRefresh, Modifier.padding(16.dp))
                }

                // Gallery Grid
                LazyVerticalGrid(
                    columns = if (state.isGridView) GridCells.Adaptive(104.dp) else GridCells.Fixed(1),
                    state = gridState,
                    modifier = Modifier
                        .weight(1f)
                        .testTag("cloud-gallery"),
                    contentPadding = PaddingValues(
                        start = 3.dp,
                        end = 3.dp,
                        top = 4.dp,
                        bottom = if (state.selectedIds.isNotEmpty()) 16.dp else 80.dp
                    ),
                    horizontalArrangement = Arrangement.spacedBy(3.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp)
                ) {
                    if (state.selectedIds.isEmpty()) {
                        item(key = "filters", span = { GridItemSpan(maxLineSpan) }) {
                            DriveMediaFilterStrip(state.mediaFilter, onMediaFilterChange)
                        }
                    }

                    if (state.isLoading) item(key = "loading", span = { GridItemSpan(maxLineSpan) }) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                            Text(stringResource(R.string.clean_gallery_loading), style = MaterialTheme.typography.bodySmall)
                        }
                    }

                    if (!state.isLoading && filteredItems.isEmpty()) item(key = "empty", span = { GridItemSpan(maxLineSpan) }) {
                        AutoGramEmptyState(
                            stringResource(R.string.clean_gallery_empty),
                            stringResource(R.string.clean_gallery_empty_hint),
                            modifier = Modifier.padding(20.dp)
                        )
                    }

                    sections.forEach { section ->
                        item(key = "date:${section.key}", span = { GridItemSpan(maxLineSpan) }) {
                            val dateLabel = section.timestampMs?.let { ts ->
                                val now = java.util.Calendar.getInstance()
                                val itemCal = java.util.Calendar.getInstance().apply { timeInMillis = ts }
                                if (now.get(java.util.Calendar.YEAR) == itemCal.get(java.util.Calendar.YEAR) &&
                                    now.get(java.util.Calendar.DAY_OF_YEAR) == itemCal.get(java.util.Calendar.DAY_OF_YEAR)) {
                                    stringResource(R.string.ui2_today)
                                } else if (now.get(java.util.Calendar.YEAR) == itemCal.get(java.util.Calendar.YEAR) &&
                                    now.get(java.util.Calendar.DAY_OF_YEAR) - itemCal.get(java.util.Calendar.DAY_OF_YEAR) == 1) {
                                    stringResource(R.string.ui2_yesterday)
                                } else {
                                    android.text.format.DateFormat.getMediumDateFormat(context).format(Date(ts))
                                }
                            } ?: stringResource(R.string.clean_gallery_unknown_date)

                            Text(
                                text = dateLabel,
                                modifier = Modifier.padding(start = 14.dp, top = 16.dp, bottom = 6.dp),
                                style = MaterialTheme.typography.titleSmall.copy(
                                    fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                                    fontSize = 13.sp
                                ),
                                color = TextPrimaryDark
                            )
                        }

                        items(section.items, key = { "media:${it.id}" }) { item ->
                            if (state.isGridView) FileGridItem(
                                item = item,
                                isSelected = item.id in state.selectedIds,
                                onClick = { onItemClick(item) },
                                onLongClick = { onItemLongClick(item) },
                                aspectRatio = state.gridAspectRatio.ratio
                            )
                            else FileListItem(
                                item,
                                item.id in state.selectedIds,
                                { onItemClick(item) },
                                { onItemLongClick(item) },
                                Modifier.padding(horizontal = 12.dp, vertical = 3.dp)
                            )
                        }
                    }

                    item(key = "pagination", span = { GridItemSpan(maxLineSpan) }) {
                        Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { pagingControls?.invoke() }
                    }
                }
                // Consume measured space, including accessibility font scaling.
                DriveBottomActionBar(state.selectedIds.size, onCleanForward, onTagCategory,
                    onMoveFolder, onDownloadZip, onDeleteSelected)
            }

            // Speed-Dial FAB in Normal Mode
            if (state.selectedIds.isEmpty()) {
                DriveSpeedDialFab(
                    isForum = state.isForum,
                    onUpload = onUpload,
                    onRemoteUpload = onRemoteUpload,
                    onAddTopic = onAddTopic,
                    modifier = Modifier.fillMaxSize()
                )
            }

        }
    }
}
