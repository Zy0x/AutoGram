package com.autogram.app.ui.studio

import androidx.compose.animation.*
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
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
import com.autogram.app.ui.drive.DrivePreviewModal
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
    var isPoster23Mode by remember { mutableStateOf(true) }
    var isTranscodeModalOpen by remember { mutableStateOf(false) }
    var previewItem by remember { mutableStateOf<DriveFileItem?>(null) }
    var toastMessage by remember { mutableStateOf<String?>(null) }

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
        Box(modifier = Modifier.fillMaxSize()) {
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
                    // 1. Header Row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
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

                        // View Mode Switcher (2:3 vs 1:1)
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = Color(0x22FFFFFF),
                            border = BorderStroke(1.dp, Color(0x33FFFFFF))
                        ) {
                            Row(
                                modifier = Modifier.padding(2.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Surface(
                                    onClick = { isPoster23Mode = true },
                                    shape = RoundedCornerShape(8.dp),
                                    color = if (isPoster23Mode) GoldAccent.copy(alpha = 0.25f) else Color.Transparent,
                                    border = if (isPoster23Mode) BorderStroke(1.dp, GoldAccent) else null
                                ) {
                                    Text(
                                        text = "2:3",
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontSize = 11.sp,
                                            fontWeight = if (isPoster23Mode) FontWeight.Bold else FontWeight.Normal
                                        ),
                                        color = if (isPoster23Mode) GoldAccent else TextSecondaryDark
                                    )
                                }
                                Surface(
                                    onClick = { isPoster23Mode = false },
                                    shape = RoundedCornerShape(8.dp),
                                    color = if (!isPoster23Mode) MutedIceCyan.copy(alpha = 0.25f) else Color.Transparent,
                                    border = if (!isPoster23Mode) BorderStroke(1.dp, MutedIceCyan) else null
                                ) {
                                    Text(
                                        text = "1:1",
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontSize = 11.sp,
                                            fontWeight = if (!isPoster23Mode) FontWeight.Bold else FontWeight.Normal
                                        ),
                                        color = if (!isPoster23Mode) MutedIceCyan else TextSecondaryDark
                                    )
                                }
                            }
                        }
                    }

                    // 2. Metric Cards
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        AutoGramMetricCard(
                            icon = Icons.Default.Collections,
                            value = mediaItems.size.toString(),
                            label = stringResource(R.string.studio_metric_media),
                            accent = ChampagneGold,
                            modifier = Modifier.weight(1f)
                        )
                        AutoGramMetricCard(
                            icon = Icons.Default.Image,
                            value = imageCount.toString(),
                            label = stringResource(R.string.studio_metric_images),
                            accent = MutedIceCyan,
                            modifier = Modifier.weight(1f)
                        )
                        AutoGramMetricCard(
                            icon = Icons.Default.Movie,
                            value = videoCount.toString(),
                            label = stringResource(R.string.studio_metric_videos),
                            accent = SoftViolet,
                            modifier = Modifier.weight(1f)
                        )
                    }

                    // 3. Filter Chips
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(
                            DriveMediaFilter.ALL to (R.string.drive_filter_all to ChampagneGold),
                            DriveMediaFilter.IMAGES to (R.string.drive_filter_images to CategoryPhoto),
                            DriveMediaFilter.VIDEOS to (R.string.drive_filter_videos to CategoryVideo),
                            DriveMediaFilter.AUDIO to (R.string.drive_filter_audio to CategoryAudio)
                        ).forEach { (filter, pair) ->
                            val (labelRes, accent) = pair
                            val isSelected = state.mediaFilter == filter

                            Surface(
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .clickable { onMediaFilterChange(filter) },
                                shape = CircleShape,
                                color = if (isSelected) accent.copy(alpha = 0.16f) else Color.Transparent,
                                border = BorderStroke(1.dp, if (isSelected) accent.copy(alpha = 0.45f) else BorderHairline)
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

                // 4. Gallery Grid (2-Column 2:3 Poster Mode or Adaptive 1:1)
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
                            columns = if (isPoster23Mode) GridCells.Fixed(2) else GridCells.Adaptive(minSize = 130.dp),
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(top = 8.dp, bottom = 120.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(visible, key = { it.id }) { item ->
                                if (isPoster23Mode) {
                                    StudioMediaCard23(
                                        item = item,
                                        isSelected = state.selectedIds.contains(item.id),
                                        onClick = {
                                            if (state.selectedIds.isNotEmpty()) {
                                                onToggleSelection(item.id)
                                            } else {
                                                previewItem = item
                                            }
                                        },
                                        onLongClick = { onToggleSelection(item.id) }
                                    )
                                } else {
                                    FileGridItem(
                                        item = item,
                                        isSelected = state.selectedIds.contains(item.id),
                                        onClick = {
                                            if (state.selectedIds.isNotEmpty()) {
                                                onToggleSelection(item.id)
                                            } else {
                                                previewItem = item
                                            }
                                        },
                                        onLongClick = { onToggleSelection(item.id) }
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // 5. Floating Batch Action Dock when items selected
            AnimatedVisibility(
                visible = state.selectedIds.isNotEmpty(),
                enter = slideInVertically(initialOffsetY = { it }) + fadeIn(),
                exit = slideOutVertically(targetOffsetY = { it }) + fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 80.dp, start = 16.dp, end = 16.dp)
            ) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    color = Color(0xF50B1C30),
                    border = BorderStroke(1.5.dp, GoldAccent.copy(alpha = 0.5f)),
                    shadowElevation = 12.dp
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = stringResource(R.string.studio_selected_counter, state.selectedIds.size),
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                color = GoldAccent
                            )
                            Text(
                                text = "Aksi Batch Studio",
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.5.sp),
                                color = TextSecondaryDark
                            )
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            // Transcode Button
                            Button(
                                onClick = { isTranscodeModalOpen = true },
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = GoldAccent,
                                    contentColor = CanvasDeepNavy
                                ),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Icon(Icons.Default.Memory, null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    text = "Transcode",
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold)
                                )
                            }

                            // Build Album Button
                            Button(
                                onClick = { toastMessage = "Album berhasil dirakit dan dikirim!" },
                                shape = RoundedCornerShape(10.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MutedIceCyan,
                                    contentColor = CanvasDeepNavy
                                ),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                            ) {
                                Icon(Icons.Default.Collections, null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    text = "Album",
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold)
                                )
                            }
                        }
                    }
                }
            }

            // 6. Transcode Preset Modal
            if (isTranscodeModalOpen) {
                StudioTranscodeModal(
                    selectedCount = state.selectedIds.size,
                    onDismiss = { isTranscodeModalOpen = false },
                    onStartTranscode = {
                        toastMessage = "Tugas transcode batch berhasil ditambahkan ke Manajer Transfer!"
                    }
                )
            }

            // 7. Fullscreen Media Previewer Modal
            val currentPreview = previewItem
            if (currentPreview != null) {
                DrivePreviewModal(
                    item = currentPreview,
                    onDismiss = { previewItem = null }
                )
            }
        }
    }
}