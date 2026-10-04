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
    var previewItem by remember { mutableStateOf<DriveFileItem?>(null) }
    var zipArchiveItem by remember { mutableStateOf<DriveFileItem?>(null) }
    var isDriveToolsOpen by remember { mutableStateOf(false) }
    var isDestinationModalOpen by remember { mutableStateOf(false) }
    var isTagModalOpen by remember { mutableStateOf(false) }
    var isMoveModalOpen by remember { mutableStateOf(false) }
    var isDeleteModalOpen by remember { mutableStateOf(false) }
    var unsupported by remember { mutableStateOf(false) }
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
        isDestinationModalOpen = false
        isTagModalOpen = false
        isMoveModalOpen = false
        isDeleteModalOpen = false
    }

    LaunchedEffect(state.sessionId) {
        if (state.sessionId.isNotBlank()) viewModel.loadLocations()
    }

    DriveScreenContent(
        state = state,
        modifier = modifier,
        onSearchChange = viewModel::setSearchQuery,
        onMediaFilterChange = viewModel::setMediaFilter,
        onThumbnailQualityChange = viewModel::setThumbnailQuality,
        onGridAspectRatioChange = viewModel::setGridAspectRatio,
        onToggleViewMode = viewModel::toggleViewMode,
        onRefresh = { viewModel.loadFolder(state.currentPath) },
        onUpload = { unsupported = true },
        onClearSelection = viewModel::clearSelection,
        onSelectAll = { viewModel.selectAll(galleryItems(state.items, state.searchQuery, state.mediaFilter)) },
        onInvertSelection = { viewModel.invertSelection(galleryItems(state.items, state.searchQuery, state.mediaFilter)) },
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
        cloudControls = { DownloadPanel(state.sessionId, downloadItem, { downloadItem = null }) },
        storyControls = { DriveStories(cloudState, viewModel::loadLocations, viewModel::chooseLocation) },
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
        DriveToolsModal(
            allItems = state.items,
            onDismiss = { isDriveToolsOpen = false }
        )
    }

    if (isDestinationModalOpen) {
        DriveChatDestinationModal(
            selectedCount = state.selectedIds.size.coerceAtLeast(1),
            locations = cloudState.locations,
            onForward = { target, clean ->
                val count = state.selectedIds.size.coerceAtLeast(1)
                android.widget.Toast.makeText(
                    context,
                    context.getString(R.string.drive_forward_success, count),
                    android.widget.Toast.LENGTH_SHORT
                ).show()
                viewModel.clearSelection()
            },
            onDismiss = { isDestinationModalOpen = false }
        )
    }

    if (isTagModalOpen) {
        DriveTagCategoryModal(
            selectedCount = state.selectedIds.size.coerceAtLeast(1),
            onApply = { category, tag ->
                val count = state.selectedIds.size.coerceAtLeast(1)
                android.widget.Toast.makeText(
                    context,
                    context.getString(R.string.drive_tag_success, count),
                    android.widget.Toast.LENGTH_SHORT
                ).show()
                viewModel.clearSelection()
            },
            onDismiss = { isTagModalOpen = false }
        )
    }

    if (isMoveModalOpen) {
        DriveMoveFolderModal(
            selectedCount = state.selectedIds.size.coerceAtLeast(1),
            currentPath = state.currentPath,
            onMove = { targetPath ->
                val count = state.selectedIds.size.coerceAtLeast(1)
                android.widget.Toast.makeText(
                    context,
                    context.getString(R.string.drive_move_success, count, targetPath),
                    android.widget.Toast.LENGTH_SHORT
                ).show()
                viewModel.clearSelection()
            },
            onDismiss = { isMoveModalOpen = false }
        )
    }

    if (isDeleteModalOpen) {
        DriveConfirmDeleteModal(
            selectedCount = state.selectedIds.size.coerceAtLeast(1),
            onConfirm = {
                val count = state.selectedIds.size.coerceAtLeast(1)
                viewModel.clearSelection()
                android.widget.Toast.makeText(
                    context,
                    "Berhasil menghapus $count berkas dari cloud",
                    android.widget.Toast.LENGTH_SHORT
                ).show()
                viewModel.loadFolder(state.currentPath)
            },
            onDismiss = { isDeleteModalOpen = false }
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
    onThumbnailQualityChange: (DriveThumbnailQuality) -> Unit = {},
    onGridAspectRatioChange: (DriveGridAspectRatio) -> Unit = {},
    onToggleViewMode: () -> Unit,
    onRefresh: () -> Unit,
    onUpload: () -> Unit,
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
    onItemClick: (DriveFileItem) -> Unit,
    onItemLongClick: (DriveFileItem) -> Unit,
    cloudControls: (@Composable () -> Unit)? = null,
    storyControls: (@Composable () -> Unit)? = null,
    pagingControls: (@Composable () -> Unit)? = null
) {
    val filteredItems = remember(state.items, state.searchQuery, state.mediaFilter) {
        galleryItems(state.items, state.searchQuery, state.mediaFilter)
    }
    val sections = remember(filteredItems) { gallerySections(filteredItems) }
    val context = LocalContext.current
    val gridState = rememberLazyGridState()
    LaunchedEffect(state.sessionId, state.peerId, state.searchQuery, state.mediaFilter) { gridState.scrollToItem(0) }
    AutoGramSurface(modifier) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            // Keep the worker/export owner mounted when gallery headers scroll off screen.
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.nav_drive), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                cloudControls?.invoke()
            }
            LazyVerticalGrid(
                columns = if (state.isGridView) GridCells.Adaptive(104.dp) else GridCells.Fixed(1),
                state = gridState, modifier = Modifier.weight(1f).testTag("cloud-gallery"),
                contentPadding = PaddingValues(start = 3.dp, end = 3.dp, bottom = 112.dp),
                horizontalArrangement = Arrangement.spacedBy(3.dp), verticalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                item(key = "stories", span = { GridItemSpan(maxLineSpan) }) { storyControls?.invoke() }
                item(key = "controls", span = { GridItemSpan(maxLineSpan) }) {
                    DriveTopBar(
                        currentPath = state.currentPath,
                        itemCount = filteredItems.size,
                        selectedCount = state.selectedIds.size,
                        searchQuery = state.searchQuery,
                        onSearchChange = onSearchChange,
                        mediaFilter = state.mediaFilter,
                        onMediaFilterChange = onMediaFilterChange,
                        thumbnailQuality = state.thumbnailQuality,
                        onThumbnailQualityChange = onThumbnailQualityChange,
                        gridAspectRatio = state.gridAspectRatio,
                        onGridAspectRatioChange = onGridAspectRatioChange,
                        isGridView = state.isGridView,
                        onToggleViewMode = onToggleViewMode,
                        onRefresh = onRefresh,
                        onUpload = onUpload,
                        onClearSelection = onClearSelection,
                        onSelectAll = onSelectAll,
                        onInvertSelection = onInvertSelection,
                        onDownloadZip = onDownloadZip,
                        onCleanForward = onCleanForward,
                        onMoveFolder = onMoveFolder,
                        onCopyLinks = onCopyLinks,
                        onTagCategory = onTagCategory,
                        onDeleteSelected = onDeleteSelected,
                        onOpenTools = onOpenTools
                    )
                }
                state.errorCode?.let { code ->
                    item(key = "error", span = { GridItemSpan(maxLineSpan) }) {
                        AutoGramErrorState(stringResource(cloudErrorLabel(code)), onRefresh, Modifier.padding(16.dp))
                    }
                }
                if (state.isLoading) item(key = "loading", span = { GridItemSpan(maxLineSpan) }) {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                        Text(stringResource(R.string.clean_gallery_loading), style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (!state.isLoading && filteredItems.isEmpty()) item(key = "empty", span = { GridItemSpan(maxLineSpan) }) {
                    AutoGramEmptyState(stringResource(R.string.clean_gallery_empty),
                        stringResource(R.string.clean_gallery_empty_hint), modifier = Modifier.padding(20.dp))
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
                            modifier = Modifier.padding(start = 14.dp, top = 20.dp, bottom = 8.dp),
                            style = MaterialTheme.typography.titleSmall.copy(
                                fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                                fontSize = 14.sp
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
                        else FileListItem(item, item.id in state.selectedIds, { onItemClick(item) },
                            { onItemLongClick(item) }, Modifier.padding(horizontal = 12.dp, vertical = 3.dp))
                    }
                }
                item(key = "pagination", span = { GridItemSpan(maxLineSpan) }) {
                    Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { pagingControls?.invoke() }
                }
            }
        }
    }
}
