package com.autogram.app.ui.drive

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun DriveBottomActionBar(selectedCount: Int, onCleanForward: () -> Unit, onTagCategory: () -> Unit,
    onMoveFolder: () -> Unit, onDownloadZip: () -> Unit, onDeleteSelected: () -> Unit, modifier: Modifier = Modifier) {
    AnimatedVisibility(selectedCount > 0, modifier = modifier) {
        Surface(color = CanvasDeepNavy) {
            Column {
                HorizontalDivider(color = BorderHairline)
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    BottomActionItem(Icons.AutoMirrored.Filled.Send, stringResource(R.string.drive_action_clean_forward),
                        MutedIceCyan, onCleanForward, Modifier.weight(1f))
                    BottomActionItem(Icons.Default.Label, stringResource(R.string.drive_action_tag_category),
                        TextSecondaryDark, onTagCategory, Modifier.weight(1f))
                    BottomActionItem(Icons.Default.DriveFileMove, stringResource(R.string.drive_action_move),
                        TextSecondaryDark, onMoveFolder, Modifier.weight(1f))
                    BottomActionItem(Icons.Default.Download, stringResource(R.string.drive_action_download),
                        MutedIceCyan, onDownloadZip, Modifier.weight(1f))
                    BottomActionItem(Icons.Default.Delete, stringResource(R.string.drive_action_delete),
                        SoftCoral, onDeleteSelected, Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun BottomActionItem(icon: ImageVector, label: String, tint: Color, onClick: () -> Unit,
    modifier: Modifier) {
    Column(modifier.heightIn(min = 64.dp).clickable(onClick = onClick).padding(horizontal = 4.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, null, Modifier.size(22.dp), tint = tint)
        Text(label, style = MaterialTheme.typography.labelSmall, color = tint, maxLines = 2,
            overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}
