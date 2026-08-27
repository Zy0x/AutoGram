package com.autogram.app.ui.drive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveMediaFilter
import com.autogram.app.ui.components.ScreenHeader
import com.autogram.app.ui.components.StatusPill

@Composable
fun DriveTopBar(
    currentPath: String,
    itemCount: Int,
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    mediaFilter: DriveMediaFilter,
    onMediaFilterChange: (DriveMediaFilter) -> Unit,
    isGridView: Boolean,
    onToggleViewMode: () -> Unit,
    onRefresh: () -> Unit,
    onUpload: () -> Unit
) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val compact = maxWidth < 620.dp
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            ScreenHeader(
                titleRes = R.string.drive_title,
                subtitleRes = R.string.drive_subtitle,
                action = {
                    if (!compact) StatusPill(pluralStringResource(R.plurals.drive_item_count, itemCount, itemCount))
                }
            )
            Text(
                text = currentPath.ifBlank { "/" },
                color = TextMutedDark,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
            TextField(
                value = searchQuery,
                onValueChange = onSearchChange,
                modifier = Modifier
                    .weight(1f)
                    .height(52.dp),
                placeholder = {
                    Text(
                        stringResource(R.string.drive_search_placeholder),
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextMutedDark
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = stringResource(R.string.drive_search_accessibility),
                        tint = TextSecondaryDark
                    )
                },
                singleLine = true,
                shape = RoundedCornerShape(10.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = SurfaceElevatedDark,
                    unfocusedContainerColor = SurfaceElevatedDark,
                    focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent
                )
            )

                if (!compact) {
                    DriveActions(isGridView, onRefresh, onToggleViewMode, onUpload)
                }
            }
            if (compact) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    StatusPill(pluralStringResource(R.plurals.drive_item_count, itemCount, itemCount), Modifier.weight(1f))
                    DriveActions(isGridView, onRefresh, onToggleViewMode, onUpload)
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                DriveMediaFilter.entries.forEach { filter ->
                    FilterChip(
                        selected = mediaFilter == filter,
                        onClick = { onMediaFilterChange(filter) },
                        label = { Text(stringResource(filter.labelResource())) },
                        leadingIcon = if (filter == DriveMediaFilter.STICKERS) {
                            {
                                Icon(Icons.Default.EmojiEmotions, null, modifier = Modifier.size(18.dp))
                            }
                        } else null
                    )
                }
            }
        }
    }
}

@Composable
private fun DriveActions(
    isGridView: Boolean,
    onRefresh: () -> Unit,
    onToggleViewMode: () -> Unit,
    onUpload: () -> Unit
) {
    IconButton(onClick = onRefresh, modifier = Modifier.size(48.dp)) {
        Icon(Icons.Default.Refresh, stringResource(R.string.drive_action_refresh), tint = TextSecondaryDark)
    }
    IconButton(onClick = onToggleViewMode, modifier = Modifier.size(48.dp)) {
        Icon(
            if (isGridView) Icons.AutoMirrored.Filled.ViewList else Icons.Default.GridView,
            stringResource(R.string.drive_toggle_view_accessibility),
            tint = TextPrimaryDark
        )
    }
    IconButton(
        onClick = onUpload,
        modifier = Modifier.size(48.dp),
        colors = IconButtonDefaults.iconButtonColors(containerColor = PrimaryBlue, contentColor = TextPrimaryDark)
    ) {
        Icon(Icons.Default.Add, stringResource(R.string.drive_action_upload))
    }
}

private fun DriveMediaFilter.labelResource(): Int = when (this) {
    DriveMediaFilter.ALL -> R.string.drive_filter_all
    DriveMediaFilter.MEDIA -> R.string.drive_filter_media
    DriveMediaFilter.IMAGES -> R.string.drive_filter_images
    DriveMediaFilter.VIDEOS -> R.string.drive_filter_videos
    DriveMediaFilter.AUDIO -> R.string.drive_filter_audio
    DriveMediaFilter.DOCUMENTS -> R.string.drive_filter_documents
    DriveMediaFilter.STICKERS -> R.string.drive_filter_stickers
}
