package com.autogram.app.ui.drive

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.autogram.app.R
import com.autogram.app.features.preview.mediaKindLabel
import com.autogram.app.viewmodel.DriveFileItem

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FileGridItem(item: DriveFileItem, isSelected: Boolean, onClick: () -> Unit,
    onLongClick: () -> Unit, modifier: Modifier = Modifier, aspectRatio: Float = 2f / 3f) {
    val visual = item.telegramCategory in setOf("photo", "video", "gif", "sticker")
    val scheme = MaterialTheme.colorScheme
    Box(modifier.fillMaxWidth().aspectRatio(aspectRatio).clip(RoundedCornerShape(4.dp))
        .testTag("drive-media-${com.autogram.app.features.preview.previewKind(item.mimeType).name.lowercase(java.util.Locale.ROOT)}")
        .background(if (isSelected) scheme.primaryContainer else scheme.surfaceVariant)
        .semantics { contentDescription = item.name; selected = isSelected }
        .combinedClickable(onClick = onClick, onLongClick = onLongClick)
        .then(if (isSelected) Modifier.border(3.dp, scheme.primary, RoundedCornerShape(4.dp)) else Modifier),
        contentAlignment = Alignment.Center) {
        if (item.thumbnailBytes != null || !item.thumbnailUri.isNullOrBlank()) {
            AsyncImage(item.thumbnailBytes ?: item.thumbnailUri, null,
                Modifier.fillMaxSize().padding(if (isSelected) 6.dp else 0.dp), contentScale = ContentScale.Crop)
        } else {
            Column(Modifier.padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(when {
                    item.isFolder -> Icons.Default.Folder
                    item.telegramCategory == "video" -> Icons.Default.PlayCircleOutline
                    item.telegramCategory == "photo" -> Icons.Default.Image
                    item.mimeType.startsWith("audio/") -> Icons.Default.Headphones
                    else -> Icons.Default.InsertDriveFile
                }, null, Modifier.size(28.dp), tint = scheme.onSurfaceVariant)
                if (!visual) Text(item.name, style = MaterialTheme.typography.labelMedium, maxLines = 2,
                    overflow = TextOverflow.Ellipsis)
            }
        }
        if (item.telegramCategory == "video" || item.mimeType.startsWith("audio/")) {
            Surface(Modifier.align(Alignment.BottomEnd).padding(6.dp), shape = RoundedCornerShape(6.dp),
                color = scheme.surface.copy(alpha = 0.92f)) {
                Row(Modifier.padding(horizontal = 6.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.PlayArrow, null, Modifier.size(14.dp))
                    val duration = item.durationSeconds?.takeIf { it.isFinite() && it >= 0 }?.toLong()
                    if (duration != null) Text(java.lang.String.format(java.util.Locale.getDefault(),
                        "%d:%02d", duration / 60, duration % 60), style = MaterialTheme.typography.labelSmall)
                }
            }
        } else if (!visual && !item.isFolder) Surface(Modifier.align(Alignment.BottomStart).padding(6.dp),
            color = scheme.surface.copy(alpha = 0.92f), shape = RoundedCornerShape(4.dp)) {
            Text(formatFileSize(item.size), Modifier.padding(4.dp), style = MaterialTheme.typography.labelSmall)
        }
        if (isSelected) Icon(Icons.Default.CheckCircle, null, Modifier.align(Alignment.TopEnd).padding(6.dp).size(24.dp),
            tint = scheme.primary)
    }
}

fun formatFileSize(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    val group = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt().coerceIn(0, units.lastIndex)
    return String.format(java.util.Locale.US, "%.1f %s", bytes / Math.pow(1024.0, group.toDouble()), units[group])
}
