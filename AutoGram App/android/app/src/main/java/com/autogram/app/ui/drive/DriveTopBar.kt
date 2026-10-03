package com.autogram.app.ui.drive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.viewmodel.DriveMediaFilter

@Composable
fun DriveTopBar(currentPath: String, itemCount: Int, selectedCount: Int, searchQuery: String,
    onSearchChange: (String) -> Unit, mediaFilter: DriveMediaFilter,
    onMediaFilterChange: (DriveMediaFilter) -> Unit, isGridView: Boolean, onToggleViewMode: () -> Unit,
    onRefresh: () -> Unit, onUpload: () -> Unit, onClearSelection: () -> Unit,
    onSelectAll: () -> Unit, onInvertSelection: () -> Unit, onDownloadZip: () -> Unit,
    onCleanForward: () -> Unit, onMoveFolder: () -> Unit, onCopyLinks: () -> Unit,
    onTagCategory: () -> Unit, onDeleteSelected: () -> Unit, onOpenTools: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (selectedCount > 0) IconButton(onClick = onClearSelection) {
                Icon(Icons.Default.Close, stringResource(R.string.drive_action_cancel))
            }
            Column(Modifier.weight(1f)) {
                Text(if (selectedCount > 0) stringResource(R.string.real_selected_count, selectedCount)
                    else stringResource(R.string.clean_gallery_title), style = MaterialTheme.typography.headlineSmall)
                if (selectedCount == 0) Text(
                    if (currentPath == "/" || currentPath == "me") stringResource(R.string.cloud_saved_messages) else currentPath,
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton(onClick = onToggleViewMode) { Icon(if (isGridView) Icons.Default.ViewList else Icons.Default.GridView,
                stringResource(R.string.drive_toggle_view_accessibility)) }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert,
                    stringResource(if (selectedCount > 0) R.string.clean_selection_actions else R.string.clean_gallery_actions)) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    val actions = if (selectedCount > 0) listOf(
                        R.string.drive_action_select_all to onSelectAll, R.string.drive_action_invert_selection to onInvertSelection,
                        R.string.drive_action_download_zip to onDownloadZip, R.string.drive_action_clean_forward to onCleanForward,
                        R.string.drive_action_move_folder to onMoveFolder, R.string.drive_action_copy_links to onCopyLinks,
                        R.string.drive_action_tag_category to onTagCategory, R.string.drive_action_delete_selected to onDeleteSelected
                    ) else listOf(R.string.drive_action_refresh to onRefresh, R.string.drive_action_upload to onUpload,
                        R.string.tools_title to onOpenTools, R.string.drive_action_select_all to onSelectAll)
                    actions.forEach { (label, action) -> DropdownMenuItem(text = { Text(stringResource(label)) },
                        onClick = { menu = false; action() }) }
                }
            }
        }
        OutlinedTextField(searchQuery, onSearchChange, singleLine = true, shape = MaterialTheme.shapes.extraLarge,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            placeholder = { Text(stringResource(R.string.drive_search_placeholder)) },
            leadingIcon = { Icon(Icons.Default.Search, stringResource(R.string.drive_search_accessibility)) },
            trailingIcon = { if (searchQuery.isNotEmpty()) IconButton(onClick = { onSearchChange("") }) {
                Icon(Icons.Default.Close, stringResource(R.string.drive_action_cancel))
            } })
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(DriveMediaFilter.entries, key = { it.name }) { filter ->
                val label = when (filter) {
                    DriveMediaFilter.ALL -> R.string.drive_filter_all
                    DriveMediaFilter.MEDIA -> R.string.drive_filter_media
                    DriveMediaFilter.IMAGES -> R.string.drive_filter_images
                    DriveMediaFilter.VIDEOS -> R.string.drive_filter_videos
                    DriveMediaFilter.AUDIO -> R.string.drive_filter_audio
                    DriveMediaFilter.DOCUMENTS -> R.string.drive_filter_documents
                    DriveMediaFilter.STICKERS -> R.string.drive_filter_stickers
                }
                FilterChip(selected = filter == mediaFilter, onClick = { onMediaFilterChange(filter) },
                    label = { Text(stringResource(label)) }, modifier = Modifier.heightIn(min = 48.dp))
            }
        }
        Text(stringResource(R.string.clean_loaded_scope, itemCount), Modifier.padding(horizontal = 20.dp),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
