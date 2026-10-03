package com.autogram.app.ui.drive

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.autogram.app.R
import com.autogram.app.features.preview.mediaKindLabel
import com.autogram.app.viewmodel.DriveFileItem

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FileGridItem(item: DriveFileItem, isSelected: Boolean, onClick: () -> Unit,
    onLongClick: () -> Unit, modifier: Modifier = Modifier) {
    Card(modifier.fillMaxWidth().aspectRatio(2f / 3f)
        .combinedClickable(onClick = onClick, onLongClick = onLongClick),
        colors = CardDefaults.cardColors(containerColor = if (isSelected)
            MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface)) {
        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            if (item.thumbnailBytes != null || !item.thumbnailUri.isNullOrBlank()) {
                AsyncImage(item.thumbnailBytes ?: item.thumbnailUri, item.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                Icon(if (item.isFolder) Icons.Default.Folder else Icons.Default.InsertDriveFile,
                    null, Modifier.size(48.dp))
            }
        }
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(item.name, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(stringResource(if (item.isFolder) R.string.real_folder else mediaKindLabel(item.mimeType)),
                style = MaterialTheme.typography.labelSmall)
            if (!item.isFolder) Text(formatFileSize(item.size), style = MaterialTheme.typography.bodySmall)
        }
    }
}

fun formatFileSize(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    val group = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt().coerceIn(0, units.lastIndex)
    return String.format(java.util.Locale.US, "%.1f %s", bytes / Math.pow(1024.0, group.toDouble()), units[group])
}
