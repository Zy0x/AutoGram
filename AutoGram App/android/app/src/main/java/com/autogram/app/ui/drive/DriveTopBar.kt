package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import com.autogram.app.ui.components.AutoGramStatusDot
import com.autogram.app.viewmodel.DriveGridAspectRatio
import com.autogram.app.viewmodel.DriveMediaFilter
import com.autogram.app.viewmodel.DriveSortOrder
import com.autogram.app.viewmodel.DriveThumbnailQuality

@Composable
fun DriveTopBar(
    currentPath: String,
    itemCount: Int,
    selectedCount: Int,
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    mediaFilter: DriveMediaFilter,
    onMediaFilterChange: (DriveMediaFilter) -> Unit,
    activeLocationTitle: String = "",
    activeLocationKind: String = "",
    activeLocationPeerId: String = "",
    onOpenLocationPicker: () -> Unit = {},
    isForum: Boolean = false,
    topics: List<DriveTopic> = emptyList(),
    activeTopicId: Long? = null,
    onTopicSelect: (Long?) -> Unit = {},
    sortOrder: DriveSortOrder = DriveSortOrder.DATE_DESC,
    onSortOrderChange: (DriveSortOrder) -> Unit = {},
    thumbnailQuality: DriveThumbnailQuality = DriveThumbnailQuality.BALANCED,
    onThumbnailQualityChange: (DriveThumbnailQuality) -> Unit = {},
    gridAspectRatio: DriveGridAspectRatio = DriveGridAspectRatio.PORTRAIT,
    onGridAspectRatioChange: (DriveGridAspectRatio) -> Unit = {},
    isGridView: Boolean,
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
    onOpenTools: () -> Unit
) {
    var menuOpen by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Location Switcher Capsule (when not in selection mode)
        if (selectedCount == 0) {
            Surface(
                onClick = onOpenLocationPicker,
                shape = RoundedCornerShape(16.dp),
                color = SurfaceElevatedDark.copy(alpha = 0.75f),
                border = BorderStroke(1.dp, BorderHairline),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    PeerAvatar(
                        title = activeLocationTitle.ifEmpty { stringResource(R.string.cloud_saved_messages) },
                        peerId = activeLocationPeerId,
                        kind = activeLocationKind,
                        size = 36.dp
                    )
                    Column(
                        modifier = Modifier.weight(1f)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Text(
                                text = activeLocationTitle.ifEmpty { stringResource(R.string.cloud_saved_messages) },
                                style = MaterialTheme.typography.titleMedium.copy(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 15.sp
                                ),
                                color = TextPrimaryDark,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false)
                            )
                            Icon(
                                imageVector = Icons.Default.KeyboardArrowDown,
                                contentDescription = stringResource(R.string.drive_switch_location_title),
                                tint = MutedIceCyan,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Text(
                            text = stringResource(R.string.drive_stats_total, itemCount),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = TextSecondaryDark
                        )
                    }
                }
            }
        }
        // Selection Mode Header vs. Google Photos Style Search Capsule
        if (selectedCount > 0) {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = SurfaceElevatedDark,
                border = BorderStroke(1.dp, MutedIceCyan.copy(alpha = 0.4f)),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = onClearSelection,
                        modifier = Modifier.size(44.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = stringResource(R.string.drive_action_cancel),
                            tint = TextPrimaryDark
                        )
                    }

                    Text(
                        text = stringResource(R.string.real_selected_count, selectedCount),
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp
                        ),
                        color = TextPrimaryDark,
                        modifier = Modifier
                            .weight(1f)
                            .padding(start = 8.dp)
                    )

                    IconButton(
                        onClick = onCleanForward,
                        modifier = Modifier.size(44.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.SwapHoriz,
                            contentDescription = stringResource(R.string.drive_action_clean_forward),
                            tint = MutedIceCyan
                        )
                    }

                    Box {
                        IconButton(
                            onClick = { menuOpen = true },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.MoreVert,
                                contentDescription = stringResource(R.string.clean_selection_actions),
                                tint = TextPrimaryDark
                            )
                        }
                        DropdownMenu(
                            expanded = menuOpen,
                            onDismissRequest = { menuOpen = false }
                        ) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_action_select_all)) },
                                onClick = { menuOpen = false; onSelectAll() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_action_invert_selection)) },
                                onClick = { menuOpen = false; onInvertSelection() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_action_download_zip)) },
                                onClick = { menuOpen = false; onDownloadZip() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_action_move_folder)) },
                                onClick = { menuOpen = false; onMoveFolder() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_action_copy_links)) },
                                onClick = { menuOpen = false; onCopyLinks() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_action_tag_category)) },
                                onClick = { menuOpen = false; onTagCategory() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_action_delete_selected)) },
                                onClick = { menuOpen = false; onDeleteSelected() }
                            )
                        }
                    }
                }
            }
        } else {
            // Google Photos Style Search & Actions Capsule
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = SurfaceGlass,
                border = BorderStroke(1.dp, BorderHairline),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = stringResource(R.string.drive_search_accessibility),
                        tint = TextSecondaryDark,
                        modifier = Modifier.size(22.dp)
                    )

                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = onSearchChange,
                        singleLine = true,
                        placeholder = {
                            Text(
                                text = stringResource(R.string.ui2_search_cloud),
                                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp),
                                color = TextMutedDark,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
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
                            .heightIn(min = 44.dp)
                    )

                    if (searchQuery.isNotEmpty()) {
                        IconButton(
                            onClick = { onSearchChange("") },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = stringResource(R.string.drive_action_cancel),
                                tint = TextSecondaryDark,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    IconButton(
                        onClick = onToggleViewMode,
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = if (isGridView) Icons.Default.ViewList else Icons.Default.GridView,
                            contentDescription = stringResource(R.string.drive_toggle_view_accessibility),
                            tint = if (isGridView) MutedIceCyan else GoldAccent,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    IconButton(
                        onClick = onRemoteUpload,
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.CloudDownload,
                            contentDescription = stringResource(R.string.drive_remote_upload_title),
                            tint = MutedIceCyan,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    IconButton(
                        onClick = onOpenTools,
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Handyman,
                            contentDescription = stringResource(R.string.drive_tools_title),
                            tint = GoldAccent,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    Box {
                        IconButton(
                            onClick = { menuOpen = true },
                            modifier = Modifier.size(40.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.MoreVert,
                                contentDescription = stringResource(R.string.clean_gallery_actions),
                                tint = TextSecondaryDark,
                                modifier = Modifier.size(20.dp)
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
                                text = { Text(stringResource(R.string.drive_action_upload)) },
                                onClick = { menuOpen = false; onUpload() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_remote_upload_title)) },
                                onClick = { menuOpen = false; onRemoteUpload() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_tools_title)) },
                                onClick = { menuOpen = false; onOpenTools() }
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.drive_action_select_all)) },
                                onClick = { menuOpen = false; onSelectAll() }
                            )
                            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
                            Text(
                                text = stringResource(R.string.drive_sort_label),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontWeight = FontWeight.Bold
                                ),
                                color = TextSecondaryDark,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                            )
                            DriveSortOrder.entries.forEach { order ->
                                val labelRes = when (order) {
                                    DriveSortOrder.DATE_DESC -> R.string.drive_sort_date_desc
                                    DriveSortOrder.DATE_ASC -> R.string.drive_sort_date_asc
                                    DriveSortOrder.NAME_ASC -> R.string.drive_sort_name_asc
                                    DriveSortOrder.NAME_DESC -> R.string.drive_sort_name_desc
                                    DriveSortOrder.SIZE_DESC -> R.string.drive_sort_size_desc
                                    DriveSortOrder.SIZE_ASC -> R.string.drive_sort_size_asc
                                }
                                DropdownMenuItem(
                                    text = {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                                        ) {
                                            Text(stringResource(labelRes))
                                            if (order == sortOrder) {
                                                Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp), tint = MutedIceCyan)
                                            }
                                        }
                                    },
                                    onClick = { menuOpen = false; onSortOrderChange(order) }
                                )
                            }
                            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
                            Text(
                                text = stringResource(R.string.drive_thumb_quality),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontWeight = FontWeight.Bold
                                ),
                                color = TextSecondaryDark,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                            )
                            DropdownMenuItem(
                                text = {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Text(stringResource(R.string.drive_thumb_saver_label))
                                        if (thumbnailQuality == DriveThumbnailQuality.SAVER) {
                                            Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp), tint = MutedIceCyan)
                                        }
                                    }
                                },
                                onClick = { menuOpen = false; onThumbnailQualityChange(DriveThumbnailQuality.SAVER) }
                            )
                            DropdownMenuItem(
                                text = {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Text(stringResource(R.string.drive_thumb_balanced_label))
                                        if (thumbnailQuality == DriveThumbnailQuality.BALANCED) {
                                            Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp), tint = MutedIceCyan)
                                        }
                                    }
                                },
                                onClick = { menuOpen = false; onThumbnailQualityChange(DriveThumbnailQuality.BALANCED) }
                            )
                                DropdownMenuItem(
                                text = {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Text(stringResource(R.string.drive_thumb_sharp_label))
                                        if (thumbnailQuality == DriveThumbnailQuality.SHARP) {
                                            Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp), tint = MutedIceCyan)
                                        }
                                    }
                                },
                                onClick = { menuOpen = false; onThumbnailQualityChange(DriveThumbnailQuality.SHARP) }
                            )
                            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
                            Text(
                                text = stringResource(R.string.drive_aspect_ratio),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontWeight = FontWeight.Bold
                                ),
                                color = TextSecondaryDark,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                            )
                            DropdownMenuItem(
                                text = {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Text(stringResource(R.string.drive_ratio_portrait_label))
                                        if (gridAspectRatio == DriveGridAspectRatio.PORTRAIT) {
                                            Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp), tint = MutedIceCyan)
                                        }
                                    }
                                },
                                onClick = { menuOpen = false; onGridAspectRatioChange(DriveGridAspectRatio.PORTRAIT) }
                            )
                            DropdownMenuItem(
                                text = {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Text(stringResource(R.string.drive_ratio_square_label))
                                        if (gridAspectRatio == DriveGridAspectRatio.SQUARE) {
                                            Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp), tint = MutedIceCyan)
                                        }
                                    }
                                },
                                onClick = { menuOpen = false; onGridAspectRatioChange(DriveGridAspectRatio.SQUARE) }
                            )
                        }
                    }
                }
            }
        }

        // Forum Topics Filter Bar (if current chat is a forum supergroup)
        if (isForum && topics.isNotEmpty()) {
            DriveTopicChips(
                topics = topics,
                activeTopicId = activeTopicId,
                onSelectTopic = onTopicSelect
            )
        }

        // Filter Pills Carousel (Photos / Videos / Audio / Documents)
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
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
                val selected = filter == mediaFilter

                Surface(
                    onClick = { onMediaFilterChange(filter) },
                    shape = RoundedCornerShape(12.dp),
                    color = if (selected) MutedIceCyan.copy(alpha = 0.2f) else SurfaceGlassSoft,
                    border = BorderStroke(
                        1.dp,
                        if (selected) MutedIceCyan else BorderHairline
                    ),
                    modifier = Modifier.heightIn(min = 36.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        if (selected) {
                            AutoGramStatusDot(color = MutedIceCyan, size = 6.dp)
                        }
                        Text(
                            text = stringResource(label),
                            style = MaterialTheme.typography.labelMedium.copy(
                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                fontSize = 12.sp
                            ),
                            color = if (selected) TextPrimaryDark else TextSecondaryDark
                        )
                    }
                }
            }
        }

        // Desktop Parity: Grid Thumbnail Aspect Ratio (2:3 / 1:1) & Quality Selector (Hemat / Seimbang / Jelas)
        if (isGridView) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // Aspect Ratio Selector [ 1:1 ] [ 2:3 ]
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        text = stringResource(R.string.drive_aspect_ratio),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        ),
                        color = TextSecondaryDark
                    )
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = SurfaceElevatedDark,
                        border = BorderStroke(1.dp, BorderHairline)
                    ) {
                        Row(
                            modifier = Modifier.padding(2.dp),
                            horizontalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            DriveGridAspectRatio.entries.forEach { r ->
                                val isSelected = r == gridAspectRatio
                                val labelRes = when (r) {
                                    DriveGridAspectRatio.SQUARE -> R.string.drive_ratio_square
                                    DriveGridAspectRatio.PORTRAIT -> R.string.drive_ratio_portrait
                                }
                                Surface(
                                    onClick = { onGridAspectRatioChange(r) },
                                    shape = RoundedCornerShape(10.dp),
                                    color = if (isSelected) MutedIceCyan.copy(alpha = 0.25f) else Color.Transparent,
                                    border = if (isSelected) BorderStroke(1.dp, MutedIceCyan) else null,
                                    modifier = Modifier.defaultMinSize(minWidth = 38.dp, minHeight = 32.dp)
                                ) {
                                    Box(
                                        contentAlignment = Alignment.Center,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
                                    ) {
                                        Text(
                                            text = stringResource(labelRes),
                                            style = MaterialTheme.typography.labelSmall.copy(
                                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                                fontSize = 11.sp
                                            ),
                                            color = if (isSelected) TextPrimaryDark else TextSecondaryDark
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                // Thumbnail Quality Selector [ Hemat ] [ Seimbang ] [ Jelas ]
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = SurfaceElevatedDark,
                    border = BorderStroke(1.dp, BorderHairline)
                ) {
                    Row(
                        modifier = Modifier.padding(2.dp),
                        horizontalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        DriveThumbnailQuality.entries.forEach { q ->
                            val isSelected = q == thumbnailQuality
                            val labelRes = when (q) {
                                DriveThumbnailQuality.SAVER -> R.string.drive_thumb_saver
                                DriveThumbnailQuality.BALANCED -> R.string.drive_thumb_balanced
                                DriveThumbnailQuality.SHARP -> R.string.drive_thumb_sharp
                            }
                            Surface(
                                onClick = { onThumbnailQualityChange(q) },
                                shape = RoundedCornerShape(10.dp),
                                color = if (isSelected) MutedIceCyan.copy(alpha = 0.25f) else Color.Transparent,
                                border = if (isSelected) BorderStroke(1.dp, MutedIceCyan) else null,
                                modifier = Modifier.defaultMinSize(minWidth = 52.dp, minHeight = 32.dp)
                            ) {
                                Box(
                                    contentAlignment = Alignment.Center,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
                                ) {
                                    Text(
                                        text = stringResource(labelRes),
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                            fontSize = 11.sp
                                        ),
                                        color = if (isSelected) TextPrimaryDark else TextSecondaryDark
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

