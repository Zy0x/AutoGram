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

@Composable
fun DriveScreen(
    viewModel: DriveViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    val filteredItems = state.items.filter {
        state.searchQuery.isBlank() || it.name.contains(state.searchQuery, ignoreCase = true)
    }

    Column(
        modifier = modifier
            .fillMaxSize()
    ) {
        DriveTopBar(
            searchQuery = state.searchQuery,
            onSearchChange = viewModel::setSearchQuery,
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
                    columns = GridCells.Adaptive(minSize = 150.dp),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
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
                                    viewModel.loadFolder(item.name)
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
                                    viewModel.loadFolder(item.name)
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
