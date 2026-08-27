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
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Spacious Clean Header Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.drive_title),
                    style = MaterialTheme.typography.headlineMedium.copy(
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.3).sp
                    ),
                    color = TextPrimaryDark
                )
                Spacer(Modifier.height(1.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Folder,
                        contentDescription = null,
                        tint = ChampagneGold,
                        modifier = Modifier.size(13.dp)
                    )
                    Text(
                        text = if (currentPath.isBlank() || currentPath == "/") "Root › Telegram Cloud" else currentPath.replace("/", " › "),
                        color = TextSecondaryDark,
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                        maxLines = 1
                    )
                }
            }

            StatusPill(
                text = pluralStringResource(R.plurals.drive_item_count, itemCount, itemCount),
                color = ChampagneGold,
                isLive = true
            )
        }

        // Search & Controls Row (Clean 46dp height)
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
                    .height(46.dp),
                placeholder = {
                    Text(
                        stringResource(R.string.drive_search_placeholder),
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
                        color = TextMutedDark
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = stringResource(R.string.drive_search_accessibility),
                        tint = MutedIceCyan,
                        modifier = Modifier.size(18.dp)
                    )
                },
                singleLine = true,
                shape = CircleShape,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = SurfaceGlass,
                    unfocusedContainerColor = SurfaceGlassSoft,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    focusedTextColor = TextPrimaryDark,
                    unfocusedTextColor = TextPrimaryDark
                )
            )

            // Minimalist Action Icons
            Surface(
                onClick = onRefresh,
                modifier = Modifier.size(42.dp),
                shape = CircleShape,
                color = SurfaceGlass,
                border = BorderStroke(1.dp, BorderHairline)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.Refresh, stringResource(R.string.drive_action_refresh), tint = TextSecondaryDark, modifier = Modifier.size(18.dp))
                }
            }

            Surface(
                onClick = onToggleViewMode,
                modifier = Modifier.size(42.dp),
                shape = CircleShape,
                color = SurfaceGlass,
                border = BorderStroke(1.dp, BorderHairline)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        if (isGridView) Icons.AutoMirrored.Filled.ViewList else Icons.Default.GridView,
                        stringResource(R.string.drive_toggle_view_accessibility),
                        tint = ChampagneGold,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            Surface(
                onClick = onUpload,
                modifier = Modifier
                    .size(42.dp)
                    .clip(CircleShape),
                shape = CircleShape,
                color = Color.Transparent
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(ChampagneToCyanBrush),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Add, stringResource(R.string.drive_action_upload), tint = Color.White, modifier = Modifier.size(20.dp))
                }
            }
        }

        // Minimalist Filter Tabs
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            DriveMediaFilter.entries.forEach { filter ->
                val isSelected = mediaFilter == filter
                val filterColor = when (filter) {
                    DriveMediaFilter.ALL -> ChampagneGold
                    DriveMediaFilter.MEDIA, DriveMediaFilter.VIDEOS -> CategoryVideo
                    DriveMediaFilter.IMAGES -> CategoryPhoto
                    DriveMediaFilter.AUDIO -> CategoryAudio
                    DriveMediaFilter.DOCUMENTS -> CategoryDoc
                    DriveMediaFilter.STICKERS -> DustySage
                }

                val chipBg by animateColorAsState(
                    targetValue = if (isSelected) filterColor.copy(alpha = 0.16f) else Color.Transparent,
                    label = "chipBg"
                )
                val chipBorder by animateColorAsState(
                    targetValue = if (isSelected) filterColor.copy(alpha = 0.45f) else BorderHairline,
                    label = "chipBorder"
                )
                val chipText by animateColorAsState(
                    targetValue = if (isSelected) TextPrimaryDark else TextMutedDark,
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
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp)
                    ) {
                        if (isSelected) {
                            AutoGramStatusDot(color = filterColor, isPulsing = false, size = 5.dp)
                        }
                        Text(
                            text = stringResource(filter.labelResource()),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                fontSize = 11.sp
                            ),
                            color = chipText
                        )
                    }
                }
            }
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
