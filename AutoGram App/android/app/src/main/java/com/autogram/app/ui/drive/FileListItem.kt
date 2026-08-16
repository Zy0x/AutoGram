package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveFileItem

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FileListItem(
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
            .defaultMinSize(minHeight = 56.dp)
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            ),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) SurfaceElevatedDark else SurfaceDark
        ),
        border = border
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                imageVector = when {
                    item.isFolder -> Icons.Default.Folder
                    item.mimeType.startsWith("video") -> Icons.Default.VideoLibrary
                    item.mimeType.startsWith("image") -> Icons.Default.Image
                    item.mimeType.contains("pdf") -> Icons.Default.Description
                    else -> Icons.Default.InsertDriveFile
                },
                contentDescription = item.mimeType,
                tint = if (item.isFolder) PrimaryBlue else TextPrimaryDark,
                modifier = Modifier.size(28.dp)
            )

            Column(modifier = Modifier.weight(1f)) {
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

            if (isSelected) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "Selected",
                    tint = PrimaryBlue,
                    modifier = Modifier.size(22.dp)
                )
            }
        }
    }
}
