package com.autogram.app.ui.studio

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Collections
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.AccentCyan
import com.autogram.app.theme.AccentViolet
import com.autogram.app.theme.PrimaryBlue
import com.autogram.app.theme.TextMutedDark
import com.autogram.app.theme.TextPrimaryDark
import com.autogram.app.ui.components.MetricCard
import com.autogram.app.ui.components.ScreenHeader
import com.autogram.app.ui.drive.FileGridItem
import com.autogram.app.viewmodel.DriveMediaFilter
import com.autogram.app.viewmodel.DriveViewModel

@Composable
fun StudioScreen(
    viewModel: DriveViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val mediaItems = state.items.filter { !it.isFolder && it.telegramCategory.lowercase() != "sticker" }
    val imageCount = mediaItems.count { it.telegramCategory.equals("photo", true) }
    val videoCount = mediaItems.count { it.telegramCategory.equals("video", true) }
    val visible = when (state.mediaFilter) {
        DriveMediaFilter.IMAGES -> mediaItems.filter { it.telegramCategory.equals("photo", true) }
        DriveMediaFilter.VIDEOS -> mediaItems.filter { it.telegramCategory.equals("video", true) }
        DriveMediaFilter.AUDIO -> mediaItems.filter { it.mimeType.startsWith("audio/") }
        else -> mediaItems
    }.filter { state.searchQuery.isBlank() || it.name.contains(state.searchQuery, true) }

    BoxWithConstraints(modifier.fillMaxSize()) {
        val wide = maxWidth >= 760.dp
        Column(Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 22.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)
            ) {
                ScreenHeader(
                    titleRes = R.string.studio_title,
                    subtitleRes = R.string.studio_subtitle,
                    action = {
                        IconButton(onClick = { viewModel.loadFolder(state.currentPath) }) {
                            Icon(Icons.Default.Refresh, stringResource(R.string.drive_action_refresh), tint = TextPrimaryDark)
                        }
                    }
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    MetricCard(
                        Icons.Default.Collections,
                        mediaItems.size.toString(),
                        stringResource(R.string.studio_metric_media),
                        PrimaryBlue,
                        Modifier.weight(1f)
                    )
                    MetricCard(
                        Icons.Default.Image,
                        imageCount.toString(),
                        stringResource(R.string.studio_metric_images),
                        AccentCyan,
                        Modifier.weight(1f)
                    )
                    if (wide) {
                        MetricCard(
                            Icons.Default.Movie,
                            videoCount.toString(),
                            stringResource(R.string.studio_metric_videos),
                            AccentViolet,
                            Modifier.weight(1f)
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(
                        DriveMediaFilter.ALL to R.string.drive_filter_all,
                        DriveMediaFilter.IMAGES to R.string.drive_filter_images,
                        DriveMediaFilter.VIDEOS to R.string.drive_filter_videos
                    ).forEach { (filter, label) ->
                        FilterChip(
                            selected = state.mediaFilter == filter,
                            onClick = { viewModel.setMediaFilter(filter) },
                            label = { Text(stringResource(label)) }
                        )
                    }
                }
            }

            if (visible.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.studio_empty), color = TextMutedDark, style = MaterialTheme.typography.bodyLarge)
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(if (wide) 210.dp else 158.dp),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(visible, key = { it.id }) { item ->
                        FileGridItem(
                            item = item,
                            isSelected = state.selectedIds.contains(item.id),
                            onClick = { viewModel.toggleItemSelection(item.id) },
                            onLongClick = { viewModel.toggleItemSelection(item.id) }
                        )
                    }
                }
            }
        }
    }
}
