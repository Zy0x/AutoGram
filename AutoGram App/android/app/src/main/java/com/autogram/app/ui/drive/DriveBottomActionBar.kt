package com.autogram.app.ui.drive

import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun DriveBottomActionBar(
    selectedCount: Int,
    onCleanForward: () -> Unit,
    onTagCategory: () -> Unit,
    onMoveFolder: () -> Unit,
    onDownloadZip: () -> Unit,
    onDeleteSelected: () -> Unit,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(
        visible = selectedCount > 0,
        enter = slideInVertically(initialOffsetY = { it }) + fadeIn(),
        exit = slideOutVertically(targetOffsetY = { it }) + fadeOut(),
        modifier = modifier
    ) {
        Surface(
            shape = RoundedCornerShape(22.dp),
            color = SurfaceDock.copy(alpha = 0.95f),
            border = BorderStroke(1.dp, CardNavyBorder),
            shadowElevation = 8.dp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                // Forward Clean-Copy
                BottomActionItem(
                    icon = Icons.AutoMirrored.Filled.Send,
                    label = stringResource(R.string.drive_action_clean_forward),
                    tint = MutedIceCyan,
                    onClick = onCleanForward
                )

                // Tag Category
                BottomActionItem(
                    icon = Icons.Default.Label,
                    label = stringResource(R.string.drive_action_tag_category),
                    tint = SoftViolet,
                    onClick = onTagCategory
                )

                // Move Folder
                BottomActionItem(
                    icon = Icons.Default.DriveFileMove,
                    label = stringResource(R.string.drive_action_move),
                    tint = Color.White,
                    onClick = onMoveFolder
                )

                // Download
                BottomActionItem(
                    icon = Icons.Default.Download,
                    label = stringResource(R.string.drive_action_download),
                    tint = DustySage,
                    onClick = onDownloadZip
                )

                // Delete
                BottomActionItem(
                    icon = Icons.Default.Delete,
                    label = stringResource(R.string.drive_action_delete),
                    tint = SoftCoral,
                    onClick = onDeleteSelected
                )
            }
        }
    }
}

@Composable
private fun BottomActionItem(
    icon: ImageVector,
    label: String,
    tint: Color,
    onClick: () -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 4.dp)
    ) {
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = tint.copy(alpha = 0.15f),
            modifier = Modifier.size(36.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = icon,
                    contentDescription = label,
                    tint = tint,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall.copy(
                fontWeight = FontWeight.SemiBold,
                fontSize = 10.sp
            ),
            color = tint,
            maxLines = 1
        )
    }
}
