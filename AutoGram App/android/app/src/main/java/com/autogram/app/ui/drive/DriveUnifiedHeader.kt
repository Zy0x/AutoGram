package com.autogram.app.ui.drive

import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun DriveUnifiedHeader(
    selectedCount: Int,
    activeLocationTitle: String,
    activeLocationKind: String,
    activeLocationPeerId: String,
    isForum: Boolean,
    onOpenLocationPicker: () -> Unit,
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    onOpenViewOptions: () -> Unit,
    onRefresh: () -> Unit,
    onOpenTools: () -> Unit,
    onCustomizeIcon: () -> Unit,
    onClearSelection: () -> Unit,
    onSelectAll: () -> Unit,
    onInvertSelection: () -> Unit,
    onDownloadZip: () -> Unit,
    onCopyLinks: () -> Unit,
    modifier: Modifier = Modifier
) {
    var isSearchExpanded by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = SurfaceElevatedDark.copy(alpha = 0.85f),
        border = BorderStroke(
            1.dp,
            if (selectedCount > 0) MutedIceCyan.copy(alpha = 0.5f) else BorderHairline
        ),
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
    ) {
        AnimatedContent(
            targetState = selectedCount > 0,
            label = "header_mode_transition"
        ) { inSelectionMode ->
            if (inSelectionMode) {
                // Multi-Selection Mode Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        IconButton(
                            onClick = onClearSelection,
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = stringResource(R.string.drive_action_cancel),
                                tint = TextPrimaryDark,
                                modifier = Modifier.size(20.dp)
                            )
                        }

                        Text(
                            text = stringResource(R.string.clean_selection_actions, selectedCount),
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp
                            ),
                            color = MutedIceCyan
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        TextButton(onClick = onSelectAll) {
                            Text(
                                text = stringResource(R.string.drive_action_select_all),
                                style = MaterialTheme.typography.labelMedium.copy(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 12.sp
                                ),
                                color = TextPrimaryDark
                            )
                        }

                        Box {
                            IconButton(
                                onClick = { menuOpen = true },
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.MoreVert,
                                    contentDescription = stringResource(R.string.clean_gallery_actions),
                                    tint = TextSecondaryDark,
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            DropdownMenu(
                                expanded = menuOpen,
                                onDismissRequest = { menuOpen = false }
                            ) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.drive_action_invert_selection)) },
                                    onClick = { menuOpen = false; onInvertSelection() }
                                )
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.drive_action_copy_links)) },
                                    onClick = { menuOpen = false; onCopyLinks() }
                                )
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.drive_action_download_zip)) },
                                    onClick = { menuOpen = false; onDownloadZip() }
                                )
                            }
                        }
                    }
                }
            } else {
                // Normal Mode Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (!isSearchExpanded) {
                        // Location Picker Trigger Capsule
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .clickable(onClick = onOpenLocationPicker)
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            PeerAvatar(
                                title = activeLocationTitle.ifEmpty { stringResource(R.string.cloud_saved_messages) },
                                peerId = activeLocationPeerId,
                                kind = activeLocationKind,
                                isForum = isForum,
                                size = 34.dp
                            )

                            Column(modifier = Modifier.weight(1f, fill = false)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Text(
                                        text = activeLocationTitle.ifEmpty { stringResource(R.string.cloud_saved_messages) },
                                        style = MaterialTheme.typography.titleMedium.copy(
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 14.sp
                                        ),
                                        color = TextPrimaryDark,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Icon(
                                        imageVector = Icons.Default.KeyboardArrowDown,
                                        contentDescription = stringResource(R.string.drive_switch_location_title),
                                        tint = MutedIceCyan,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }
                        }

                        // Search Toggle Button
                        IconButton(
                            onClick = { isSearchExpanded = true },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Search,
                                contentDescription = stringResource(R.string.drive_search_placeholder),
                                tint = if (searchQuery.isNotEmpty()) MutedIceCyan else TextSecondaryDark,
                                modifier = Modifier.size(19.dp)
                            )
                        }
                    } else {
                        // Expanded Search Input
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = onSearchChange,
                            placeholder = {
                                Text(
                                    text = stringResource(R.string.drive_search_placeholder),
                                    fontSize = 12.sp,
                                    color = TextMutedDark
                                )
                            },
                            singleLine = true,
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Default.Search,
                                    contentDescription = null,
                                    tint = MutedIceCyan,
                                    modifier = Modifier.size(18.dp)
                                )
                            },
                            trailingIcon = {
                                IconButton(
                                    onClick = {
                                        if (searchQuery.isNotEmpty()) onSearchChange("")
                                        else isSearchExpanded = false
                                    }
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Close,
                                        contentDescription = stringResource(R.string.drive_action_cancel),
                                        tint = TextSecondaryDark,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            },
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Color.Transparent,
                                unfocusedBorderColor = Color.Transparent,
                                focusedTextColor = TextPrimaryDark,
                                unfocusedTextColor = TextPrimaryDark,
                                cursorColor = MutedIceCyan
                            ),
                            modifier = Modifier
                                .weight(1f)
                                .height(44.dp)
                        )
                    }

                    // Display View Options Trigger (Tune Icon)
                    IconButton(
                        onClick = onOpenViewOptions,
                        modifier = Modifier.size(36.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Tune,
                            contentDescription = stringResource(R.string.drive_view_options_title),
                            tint = GoldAccent,
                            modifier = Modifier.size(18.dp)
                        )
                    }

                    // More Menu Button (3 Dots)
                    Box {
                        IconButton(
                            onClick = { menuOpen = true },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.MoreVert,
                                contentDescription = stringResource(R.string.clean_gallery_actions),
                                tint = TextSecondaryDark,
                                modifier = Modifier.size(18.dp)
                            )
                        }

                        DropdownMenu(
                            expanded = menuOpen,
                            onDismissRequest = { menuOpen = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_action_refresh)) },
                                onClick = { menuOpen = false; onRefresh() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_tools_title)) },
                                onClick = { menuOpen = false; onOpenTools() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_customize_icon_title)) },
                                onClick = { menuOpen = false; onCustomizeIcon() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_action_select_all)) },
                                onClick = { menuOpen = false; onSelectAll() }
                            )
                        }
                    }
                }
            }
        }
    }
}
