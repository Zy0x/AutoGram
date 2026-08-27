package com.autogram.app.ui.studio

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Collections
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.*
import com.autogram.app.ui.drive.FileGridItem
import com.autogram.app.viewmodel.*

@Composable
fun StudioScreen(
    viewModel: DriveViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    StudioScreenContent(
        state = state,
        modifier = modifier,
        onRefresh = { viewModel.loadFolder(state.currentPath) },
        onMediaFilterChange = viewModel::setMediaFilter,
        onToggleSelection = viewModel::toggleItemSelection
    )
}

@Composable
fun StudioScreenContent(
    state: DriveUiState,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onMediaFilterChange: (DriveMediaFilter) -> Unit = {},
    onToggleSelection: (String) -> Unit = {}
) {
    val mediaItems = state.items.filter { !it.isFolder && it.telegramCategory.lowercase() != "sticker" }
    val imageCount = mediaItems.count { it.telegramCategory.equals("photo", true) }
    val videoCount = mediaItems.count { it.telegramCategory.equals("video", true) }
    val visible = when (state.mediaFilter) {
        DriveMediaFilter.IMAGES -> mediaItems.filter { it.telegramCategory.equals("photo", true) }
        DriveMediaFilter.VIDEOS -> mediaItems.filter { it.telegramCategory.equals("video", true) }
        DriveMediaFilter.AUDIO -> mediaItems.filter { it.mimeType.startsWith("audio/") }
        else -> mediaItems
    }.filter { state.searchQuery.isBlank() || it.name.contains(state.searchQuery, true) }

    AutoGramSurface(modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Spacious Clean Header Row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = stringResource(R.string.studio_title),
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = (-0.3).sp
                            ),
                            color = TextPrimaryDark
                        )
                        Text(
                            text = stringResource(R.string.studio_subtitle),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = TextSecondaryDark
                        )
                    }

                    Surface(
                        onClick = onRefresh,
                        modifier = Modifier.size(42.dp),
                        shape = CircleShape,
                        color = SurfaceGlass,
                        border = BorderStroke(1.dp, BorderHairline)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.Refresh, stringResource(R.string.drive_action_refresh), tint = NeonCyan, modifier = Modifier.size(18.dp))
                        }
                    }
                }

                // Compact 3-Column Glass Metric Cards
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    AutoGramMetricCard(
                        icon = Icons.Default.Collections,
                        value = mediaItems.size.toString(),
                        label = stringResource(R.string.studio_metric_media),
                        accent = NeonCyan,
                        modifier = Modifier.weight(1f)
                    )
                    AutoGramMetricCard(
                        icon = Icons.Default.Image,
                        value = imageCount.toString(),
                        label = stringResource(R.string.studio_metric_images),
                        accent = ElectricBlue,
                        modifier = Modifier.weight(1f)
                    )
                    AutoGramMetricCard(
                        icon = Icons.Default.Movie,
                        value = videoCount.toString(),
                        label = stringResource(R.string.studio_metric_videos),
                        accent = CategoryVideo,
                        modifier = Modifier.weight(1f)
                    )
                }

                // Telegram Album Builder Glass Banner if items selected
                if (state.selectedIds.isNotEmpty()) {
                    AutoGramGlassCard(
                        modifier = Modifier.fillMaxWidth(),
                        borderColor = NeonCyan.copy(alpha = 0.4f),
                        containerColor = SurfaceGlassStrong
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    text = "Telegram Album Builder",
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = "${state.selectedIds.size} media dipilih untuk dirakit",
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                    color = TextSecondaryDark
                                )
                            }

                            AutoGramGlowButton(
                                text = "✨ Rakit Album",
                                onClick = { /* Build album */ },
                                brush = CyanToBlueBrush,
                                modifier = Modifier.height(38.dp)
                            )
                        }
                    }
                }

                // Media Filter Chips
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf(
                        DriveMediaFilter.ALL to (R.string.drive_filter_all to NeonCyan),
                        DriveMediaFilter.IMAGES to (R.string.drive_filter_images to CategoryPhoto),
                        DriveMediaFilter.VIDEOS to (R.string.drive_filter_videos to CategoryVideo),
                        DriveMediaFilter.AUDIO to (R.string.drive_filter_audio to CategoryAudio)
                    ).forEach { (filter, pair) ->
                        val (labelRes, accent) = pair
                        val isSelected = state.mediaFilter == filter

                        val chipBg by animateColorAsState(
                            targetValue = if (isSelected) accent.copy(alpha = 0.16f) else Color.Transparent,
                            label = "chipBg"
                        )
                        val chipBorder by animateColorAsState(
                            targetValue = if (isSelected) accent.copy(alpha = 0.45f) else BorderHairline,
                            label = "chipBorder"
                        )

                        Surface(
                            modifier = Modifier
                                .clip(CircleShape)
                                .clickable { onMediaFilterChange(filter) },
                            shape = CircleShape,
                            color = chipBg,
                            border = BorderStroke(1.dp, chipBorder)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(5.dp)
                            ) {
                                if (isSelected) {
                                    AutoGramStatusDot(color = accent, isPulsing = false, size = 5.dp)
                                }
                                Text(
                                    text = stringResource(labelRes),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                        fontSize = 11.sp
                                    ),
                                    color = if (isSelected) TextPrimaryDark else TextMutedDark
                                )
                            }
                        }
                    }
                }
            }

            // Gallery Grid with Expansive Space
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(horizontal = 20.dp)
            ) {
                if (visible.isEmpty()) {
                    AutoGramEmptyState(
                        title = stringResource(R.string.studio_empty),
                        description = "Unggah foto atau video ke Telegram Cloud untuk melihat galeri studio.",
                        icon = Icons.Default.Collections
                    )
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(minSize = 130.dp),
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(top = 8.dp, bottom = 100.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(visible, key = { it.id }) { item ->
                            FileGridItem(
                                item = item,
                                isSelected = state.selectedIds.contains(item.id),
                                onClick = { onToggleSelection(item.id) },
                                onLongClick = { onToggleSelection(item.id) }
                            )
                        }
                    }
                }
            }
        }
    }
}
