package com.autogram.app.ui.drive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun DriveUnifiedHeader(
    selectedCount: Int, activeLocationTitle: String, activeLocationKind: String,
    activeLocationPeerId: String, isForum: Boolean, onOpenLocationPicker: () -> Unit,
    searchQuery: String, onSearchChange: (String) -> Unit, onOpenViewOptions: () -> Unit,
    onRefresh: () -> Unit, onOpenTools: () -> Unit, onCustomizeIcon: () -> Unit,
    onClearSelection: () -> Unit, onSelectAll: () -> Unit, onInvertSelection: () -> Unit,
    onDownloadZip: () -> Unit, onCopyLinks: () -> Unit, modifier: Modifier = Modifier,
    onOpenDownloads: () -> Unit = {}, compact: Boolean = false,
    locations: (@Composable () -> Unit)? = null
) {
    var menuOpen by remember(activeLocationPeerId, selectedCount > 0) { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    var searchExpanded by remember(activeLocationPeerId) { mutableStateOf(false) }
    var searchFocused by remember(activeLocationPeerId) { mutableStateOf(false) }
    val showSearch = !compact || searchExpanded || searchFocused || searchQuery.isNotEmpty()
    Column(modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = if (locations == null) 16.dp else 0.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            if (selectedCount > 0) {
                IconButton(onClick = onClearSelection, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Close, stringResource(R.string.drive_action_cancel))
                }
                Text(stringResource(R.string.clean_selection_actions, selectedCount),
                    Modifier.weight(1f), style = MaterialTheme.typography.titleMedium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            } else {
                // Exactly one location presentation: rail when provided, title only as a fallback.
                if (locations != null) Box(Modifier.weight(1f)) { locations() }
                else TextButton(onClick = onOpenLocationPicker, modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    contentPadding = PaddingValues(0.dp)) {
                    Text(activeLocationTitle.ifEmpty { stringResource(R.string.cloud_saved_messages) },
                        Modifier.weight(1f), style = MaterialTheme.typography.titleMedium,
                        color = TextPrimaryDark, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Icon(Icons.Default.KeyboardArrowDown, null, Modifier.size(20.dp), tint = TextSecondaryDark)
                }
                if (compact) IconButton(onClick = { searchExpanded = !searchExpanded }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Search, stringResource(R.string.drive_search_placeholder), tint = TextSecondaryDark)
                }
            }
            Box {
                IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.MoreVert, stringResource(R.string.clean_gallery_actions), tint = TextSecondaryDark)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    if (selectedCount == 0) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.drive_switch_location_title)) },
                            onClick = { menuOpen = false; onOpenLocationPicker() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.drive_view_options_title)) },
                            onClick = { menuOpen = false; onOpenViewOptions() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.drive_action_refresh)) },
                            onClick = { menuOpen = false; onRefresh() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.cloud_download_title)) },
                            onClick = { menuOpen = false; onOpenDownloads() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.drive_tools_title)) },
                            onClick = { menuOpen = false; onOpenTools() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.drive_customize_icon_title)) },
                            onClick = { menuOpen = false; onCustomizeIcon() })
                    }
                    DropdownMenuItem(text = { Text(stringResource(R.string.drive_action_select_all)) },
                        onClick = { menuOpen = false; onSelectAll() })
                    if (selectedCount > 0) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.drive_action_invert_selection)) },
                            onClick = { menuOpen = false; onInvertSelection() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.drive_action_copy_links)) },
                            onClick = { menuOpen = false; onCopyLinks() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.drive_action_download_zip)) },
                            onClick = { menuOpen = false; onDownloadZip() })
                    }
                }
            }
        }
        if (selectedCount == 0 && showSearch) OutlinedTextField(
            value = searchQuery, onValueChange = onSearchChange, singleLine = true,
            placeholder = { Text(stringResource(R.string.drive_search_placeholder), style = MaterialTheme.typography.bodyMedium) },
            leadingIcon = { Icon(Icons.Default.Search, null, tint = TextSecondaryDark) },
            trailingIcon = {
                if (searchQuery.isNotEmpty()) IconButton(onClick = { onSearchChange("") }) {
                    Icon(Icons.Default.Close, stringResource(R.string.drive_action_cancel))
                }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
            shape = MaterialTheme.shapes.medium,
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = SurfaceDeep, unfocusedContainerColor = SurfaceDeep,
                focusedBorderColor = MutedIceCyan, unfocusedBorderColor = androidx.compose.ui.graphics.Color.Transparent),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 56.dp).testTag("drive-search")
                .onFocusChanged { searchFocused = it.isFocused }
        )
    }
}
