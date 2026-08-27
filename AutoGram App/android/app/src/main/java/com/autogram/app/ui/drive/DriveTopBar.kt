package com.autogram.app.ui.drive

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramStatusDot
import com.autogram.app.ui.components.ScreenHeader
import com.autogram.app.ui.components.StatusPill
import com.autogram.app.viewmodel.DriveMediaFilter

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
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 20.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            ScreenHeader(
                titleRes = R.string.drive_title,
                subtitleRes = R.string.drive_subtitle,
                action = {
                    StatusPill(
                        text = pluralStringResource(R.plurals.drive_item_count, itemCount, itemCount),
                        color = NeonCyan,
                        isLive = true
                    )
                }
            )

            // Breadcrumb path display
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = SurfaceGlassSoft,
                shape = RoundedCornerShape(10.dp),
                border = BorderStroke(1.dp, BorderHairline)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.FolderOpen,
                        contentDescription = null,
                        tint = AccentCyan,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = if (currentPath.isBlank() || currentPath == "/") "Root / Telegram Cloud" else currentPath,
                        color = TextSecondaryDark,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1
                    )
                }
            }

            // Search Bar & Actions Row
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
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
                            tint = NeonCyan
                        )
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = SurfaceGlass,
                        unfocusedContainerColor = SurfaceGlassSoft,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        focusedTextColor = TextPrimaryDark,
                        unfocusedTextColor = TextPrimaryDark
                    )
                )

                DriveActions(isGridView, onRefresh, onToggleViewMode, onUpload)
            }

            // Category Filter Chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                DriveMediaFilter.entries.forEach { filter ->
                    val isSelected = mediaFilter == filter
                    val filterColor = when (filter) {
                        DriveMediaFilter.ALL -> NeonCyan
                        DriveMediaFilter.MEDIA, DriveMediaFilter.VIDEOS -> CategoryVideo
                        DriveMediaFilter.IMAGES -> CategoryPhoto
                        DriveMediaFilter.AUDIO -> CategoryAudio
                        DriveMediaFilter.DOCUMENTS -> CategoryDoc
                        DriveMediaFilter.STICKERS -> Emerald
                    }

                    val chipBg by animateColorAsState(
                        targetValue = if (isSelected) filterColor.copy(alpha = 0.18f) else SurfaceGlassSoft,
                        label = "chipBg"
                    )
                    val chipBorder by animateColorAsState(
                        targetValue = if (isSelected) filterColor.copy(alpha = 0.6f) else BorderHairline,
                        label = "chipBorder"
                    )
                    val chipText by animateColorAsState(
                        targetValue = if (isSelected) TextPrimaryDark else TextSecondaryDark,
                        label = "chipText"
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
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            if (isSelected) {
                                AutoGramStatusDot(color = filterColor, isPulsing = false, size = 6.dp)
                            }
                            Text(
                                text = stringResource(filter.labelResource()),
                                style = MaterialTheme.typography.labelMedium.copy(
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    fontSize = 12.sp
                                ),
                                color = chipText
                            )
                        }
                    }
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
    Surface(
        onClick = onRefresh,
        modifier = Modifier.size(48.dp),
        shape = RoundedCornerShape(14.dp),
        color = SurfaceGlass,
        border = BorderStroke(1.dp, BorderHairline)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Refresh, stringResource(R.string.drive_action_refresh), tint = TextSecondaryDark, modifier = Modifier.size(20.dp))
        }
    }
    Surface(
        onClick = onToggleViewMode,
        modifier = Modifier.size(48.dp),
        shape = RoundedCornerShape(14.dp),
        color = SurfaceGlass,
        border = BorderStroke(1.dp, BorderHairline)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                if (isGridView) Icons.AutoMirrored.Filled.ViewList else Icons.Default.GridView,
                stringResource(R.string.drive_toggle_view_accessibility),
                tint = NeonCyan,
                modifier = Modifier.size(20.dp)
            )
        }
    }
    Surface(
        onClick = onUpload,
        modifier = Modifier
            .size(48.dp)
            .clip(RoundedCornerShape(14.dp)),
        shape = RoundedCornerShape(14.dp),
        color = Color.Transparent
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(CyanToBlueBrush),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Default.Add, stringResource(R.string.drive_action_upload), tint = Color.White, modifier = Modifier.size(22.dp))
        }
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
