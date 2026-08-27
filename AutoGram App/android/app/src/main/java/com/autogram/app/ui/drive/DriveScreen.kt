package com.autogram.app.ui.drive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramEmptyState
import com.autogram.app.ui.components.AutoGramErrorState
import com.autogram.app.ui.components.AutoGramSurface
import com.autogram.app.viewmodel.*

@Composable
fun DriveScreen(
    viewModel: DriveViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    DriveScreenContent(
        state = state,
        modifier = modifier,
        onSearchChange = viewModel::setSearchQuery,
        onMediaFilterChange = viewModel::setMediaFilter,
        onToggleViewMode = viewModel::toggleViewMode,
        onRefresh = { viewModel.loadFolder(state.currentPath) },
        onUpload = { /* Launch system file picker */ },
        onClearSelection = viewModel::clearSelection,
        onMove = { /* Move handler */ },
        onDownload = { /* Download handler */ },
        onDeleteSelected = viewModel::deleteSelected,
        onItemClick = { item ->
            if (state.selectedIds.isNotEmpty()) {
                viewModel.toggleItemSelection(item.id)
            } else if (item.isFolder) {
                viewModel.loadFolder(childPath(state.currentPath, item.name))
            }
        },
        onItemLongClick = { item -> viewModel.toggleItemSelection(item.id) }
    )
}

@Composable
fun DriveScreenContent(
    state: DriveUiState,
    modifier: Modifier = Modifier,
    onSearchChange: (String) -> Unit = {},
    onMediaFilterChange: (DriveMediaFilter) -> Unit = {},
    onToggleViewMode: () -> Unit = {},
    onRefresh: () -> Unit = {},
    onUpload: () -> Unit = {},
    onClearSelection: () -> Unit = {},
    onMove: () -> Unit = {},
    onDownload: () -> Unit = {},
    onDeleteSelected: () -> Unit = {},
    onItemClick: (DriveFileItem) -> Unit = {},
    onItemLongClick: (DriveFileItem) -> Unit = {}
) {
    val filteredItems = state.items.filter { item ->
        val matchesSearch = state.searchQuery.isBlank() ||
            item.name.contains(state.searchQuery, ignoreCase = true)
        val category = item.telegramCategory.lowercase()
        val mime = item.mimeType.lowercase()
        val matchesType = when (state.mediaFilter) {
            DriveMediaFilter.ALL -> true
            DriveMediaFilter.MEDIA -> !item.isFolder && category in setOf("photo", "video", "gif")
            DriveMediaFilter.IMAGES -> !item.isFolder && category == "photo"
            DriveMediaFilter.VIDEOS -> !item.isFolder && category == "video"
            DriveMediaFilter.AUDIO -> !item.isFolder && (category == "audio" || mime.startsWith("audio/"))
            DriveMediaFilter.DOCUMENTS -> !item.isFolder &&
                category != "sticker" && item.deliveryKind.equals("document", ignoreCase = true)
            DriveMediaFilter.STICKERS -> !item.isFolder && category == "sticker"
        }
        matchesSearch && matchesType
    }

    AutoGramSurface(modifier = modifier) {
        Column(modifier = Modifier.fillMaxSize()) {
            DriveTopBar(
                currentPath = state.currentPath,
                itemCount = filteredItems.size,
                searchQuery = state.searchQuery,
                onSearchChange = onSearchChange,
                mediaFilter = state.mediaFilter,
                onMediaFilterChange = onMediaFilterChange,
                isGridView = state.isGridView,
                onToggleViewMode = onToggleViewMode,
                onRefresh = onRefresh,
                onUpload = onUpload
            )

            SelectionStrip(
                selectedCount = state.selectedIds.size,
                onCancel = onClearSelection,
                onMove = onMove,
                onDownload = onDownload,
                onDelete = onDeleteSelected
            )

            state.errorCode?.let { code ->
                Box(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                    AutoGramErrorState(
                        message = stringResource(R.string.drive_error, code),
                        onRetry = onRefresh
                    )
                }
            }

            if (state.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = NeonCyan)
                }
            } else if (filteredItems.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 24.dp, vertical = 32.dp),
                    contentAlignment = Alignment.TopCenter
                ) {
                    AutoGramEmptyState(
                        title = stringResource(R.string.drive_empty_title),
                        description = stringResource(R.string.drive_empty_subtitle)
                    )
                }
            } else {
                if (state.isGridView) {
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(minSize = 160.dp),
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 100.dp),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        items(filteredItems, key = { it.id }) { item ->
                            val isSelected = state.selectedIds.contains(item.id)
                            FileGridItem(
                                item = item,
                                isSelected = isSelected,
                                onClick = { onItemClick(item) },
                                onLongClick = { onItemLongClick(item) }
                            )
                        }
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 100.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(filteredItems, key = { it.id }) { item ->
                            val isSelected = state.selectedIds.contains(item.id)
                            FileListItem(
                                item = item,
                                isSelected = isSelected,
                                onClick = { onItemClick(item) },
                                onLongClick = { onItemLongClick(item) }
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun childPath(parent: String, child: String): String {
    val normalizedParent = parent.trimEnd('/').ifEmpty { "" }
    return "$normalizedParent/$child"
}

@androidx.compose.ui.tooling.preview.Preview(showBackground = true, backgroundColor = 0xFF0B0F19)
@Composable
fun DriveScreenPreview() {
    AutoGramTheme(darkTheme = true) {
        DriveScreenContent(
            state = DriveUiState(
                currentPath = "/AutoGram Drive",
                items = listOf(
                    DriveFileItem(id = "1", name = "Photos 2026", isFolder = true, size = 0, mimeType = "inode/directory", modifiedMs = 0, telegramCategory = "folder", deliveryKind = "folder"),
                    DriveFileItem(id = "2", name = "presentation.pdf", isFolder = false, size = 14500000, mimeType = "application/pdf", modifiedMs = 0, telegramCategory = "document", deliveryKind = "document"),
                    DriveFileItem(id = "3", name = "vacation_video.mp4", isFolder = false, size = 54000000, mimeType = "video/mp4", modifiedMs = 0, telegramCategory = "video", deliveryKind = "video")
                ),
                isGridView = true
            )
        )
    }
}
