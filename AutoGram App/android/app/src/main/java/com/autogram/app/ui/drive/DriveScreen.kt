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
import com.autogram.app.viewmodel.DriveViewModel
import com.autogram.app.viewmodel.DriveMediaFilter

@Composable
fun DriveScreen(
    viewModel: DriveViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

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

    Column(
        modifier = modifier
            .fillMaxSize()
    ) {
        DriveTopBar(
            currentPath = state.currentPath,
            itemCount = filteredItems.size,
            searchQuery = state.searchQuery,
            onSearchChange = viewModel::setSearchQuery,
            mediaFilter = state.mediaFilter,
            onMediaFilterChange = viewModel::setMediaFilter,
            isGridView = state.isGridView,
            onToggleViewMode = viewModel::toggleViewMode,
            onRefresh = { viewModel.loadFolder(state.currentPath) },
            onUpload = { /* Launch system file picker */ }
        )

        SelectionStrip(
            selectedCount = state.selectedIds.size,
            onCancel = viewModel::clearSelection,
            onMove = { /* Move handler */ },
            onDownload = { /* Download handler */ },
            onDelete = viewModel::deleteSelected
        )

        state.errorCode?.let { code ->
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                color = ErrorRed.copy(alpha = 0.14f),
                shape = MaterialTheme.shapes.medium
            ) {
                Text(
                    text = stringResource(R.string.drive_error, code),
                    modifier = Modifier.padding(12.dp),
                    color = ErrorRed,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }

        if (state.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = PrimaryBlue)
            }
        } else if (filteredItems.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = stringResource(R.string.drive_empty_title),
                        style = MaterialTheme.typography.headlineMedium,
                        color = TextPrimaryDark
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = stringResource(R.string.drive_empty_subtitle),
                        style = MaterialTheme.typography.bodyLarge,
                        color = TextSecondaryDark
                    )
                }
            }
        } else {
            if (state.isGridView) {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 158.dp),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(filteredItems, key = { it.id }) { item ->
                        val isSelected = state.selectedIds.contains(item.id)
                        FileGridItem(
                            item = item,
                            isSelected = isSelected,
                            onClick = {
                                if (state.selectedIds.isNotEmpty()) {
                                    viewModel.toggleItemSelection(item.id)
                                } else if (item.isFolder) {
                                    viewModel.loadFolder(childPath(state.currentPath, item.name))
                                }
                            },
                            onLongClick = { viewModel.toggleItemSelection(item.id) }
                        )
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(filteredItems, key = { it.id }) { item ->
                        val isSelected = state.selectedIds.contains(item.id)
                        FileListItem(
                            item = item,
                            isSelected = isSelected,
                            onClick = {
                                if (state.selectedIds.isNotEmpty()) {
                                    viewModel.toggleItemSelection(item.id)
                                } else if (item.isFolder) {
                                    viewModel.loadFolder(childPath(state.currentPath, item.name))
                                }
                            },
                            onLongClick = { viewModel.toggleItemSelection(item.id) }
                        )
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
