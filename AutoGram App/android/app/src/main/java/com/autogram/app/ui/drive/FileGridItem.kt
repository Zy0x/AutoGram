package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveFileItem
import coil.compose.AsyncImage
import java.util.Locale

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FileGridItem(
    item: DriveFileItem,
    isSelected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val categoryColor = when {
        item.isFolder -> ElectricBlue
        item.mimeType.startsWith("video") -> CategoryVideo
        item.mimeType.startsWith("image") -> CategoryPhoto
        item.mimeType.startsWith("audio") -> CategoryAudio
        item.mimeType.contains("pdf") || item.mimeType.contains("doc") -> CategoryDoc
        else -> CategoryDoc
    }

    val border = if (isSelected) {
        BorderStroke(1.5.dp, NeonCyan)
    } else {
        BorderStroke(1.dp, BorderHairline)
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .height(196.dp)
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            ),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) SurfaceElevatedDark.copy(alpha = 0.85f) else SurfaceGlass
        ),
        border = border
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(116.dp)
                    .padding(8.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(SurfaceDeep),
                contentAlignment = Alignment.Center
            ) {
                if (!item.thumbnailUri.isNullOrBlank()) {
                    AsyncImage(
                        model = item.thumbnailUri,
                        contentDescription = item.name,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Box(
                        modifier = Modifier
                            .size(52.dp)
                            .background(categoryColor.copy(alpha = 0.15f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = fileIcon(item),
                            contentDescription = item.mimeType,
                            tint = categoryColor,
                            modifier = Modifier.size(28.dp)
                        )
                    }
                }

                // Category badge
                Surface(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(6.dp),
                    color = ObsidianPrimary.copy(alpha = 0.85f),
                    shape = RoundedCornerShape(6.dp),
                    border = BorderStroke(0.5.dp, categoryColor.copy(alpha = 0.4f))
                ) {
                    Text(
                        text = if (item.isFolder) stringResource(R.string.drive_badge_folder) else item.telegramCategory.uppercase(),
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, fontWeight = FontWeight.Bold),
                        color = categoryColor
                    )
                }

                if (isSelected) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(6.dp)
                            .size(22.dp)
                            .background(NeonCyan, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = stringResource(R.string.drive_item_selected_accessibility),
                            tint = ObsidianPrimary,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text(
                    text = item.name,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = if (item.isFolder) "Folder" else formatFileSize(item.size),
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondaryDark
                )
            }
        }
    }
}

private fun fileIcon(item: DriveFileItem) = when {
    item.isFolder -> Icons.Default.Folder
    item.mimeType.startsWith("video") -> Icons.Default.VideoLibrary
    item.mimeType.startsWith("image") -> Icons.Default.Image
    item.mimeType.startsWith("audio") -> Icons.Default.Audiotrack
    item.mimeType.contains("pdf") -> Icons.Default.Description
    else -> Icons.AutoMirrored.Filled.InsertDriveFile
}

fun formatFileSize(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt()
    return String.format(Locale.getDefault(), "%.1f %s", bytes / Math.pow(1024.0, digitGroups.toDouble()), units[digitGroups])
}
