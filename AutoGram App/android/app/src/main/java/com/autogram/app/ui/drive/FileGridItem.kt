package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
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
    val border = if (isSelected) {
        BorderStroke(2.dp, PrimaryBlue)
    } else {
        BorderStroke(1.dp, BorderDark)
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .height(188.dp)
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            ),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) SurfaceElevatedDark else SurfaceDark
        ),
        border = border
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(112.dp)
                    .padding(8.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(SurfaceElevatedDark),
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
                    Icon(
                        imageVector = fileIcon(item),
                        contentDescription = item.mimeType,
                        tint = if (item.isFolder) PrimaryBlue else TextSecondaryDark,
                        modifier = Modifier.size(if (item.isFolder) 48.dp else 38.dp)
                    )
                }
                Surface(
                    modifier = Modifier.align(Alignment.TopStart).padding(7.dp),
                    color = BgDark.copy(alpha = .78f),
                    shape = RoundedCornerShape(7.dp)
                ) {
                    Text(
                        text = if (item.isFolder) stringResource(R.string.drive_badge_folder) else item.telegramCategory.uppercase(),
                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = TextPrimaryDark
                    )
                }
                if (isSelected) {
                    Icon(
                        imageVector = Icons.Default.CheckCircle,
                        contentDescription = stringResource(R.string.drive_item_selected_accessibility),
                        tint = PrimaryBlue,
                        modifier = Modifier.align(Alignment.TopEnd).padding(7.dp).size(24.dp)
                    )
                }
            }

            Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 11.dp, vertical = 7.dp)) {
                Text(
                    text = item.name,
                    style = MaterialTheme.typography.titleMedium,
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (!item.isFolder) {
                    Text(
                        text = formatFileSize(item.size),
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondaryDark
                    )
                }
            }
        }
    }
}

private fun fileIcon(item: DriveFileItem) = when {
    item.isFolder -> Icons.Default.Folder
    item.mimeType.startsWith("video") -> Icons.Default.VideoLibrary
    item.mimeType.startsWith("image") -> Icons.Default.Image
    item.mimeType.contains("pdf") -> Icons.Default.Description
    else -> Icons.AutoMirrored.Filled.InsertDriveFile
}

fun formatFileSize(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt()
    return String.format(Locale.getDefault(), "%.1f %s", bytes / Math.pow(1024.0, digitGroups.toDouble()), units[digitGroups])
}
