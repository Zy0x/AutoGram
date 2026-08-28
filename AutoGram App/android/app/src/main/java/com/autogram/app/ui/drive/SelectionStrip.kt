package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun SelectionStrip(
    selectedCount: Int,
    onCancel: () -> Unit,
    onCleanForward: () -> Unit = {},
    onTagCategory: () -> Unit = {},
    onMove: () -> Unit,
    onDownload: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (selectedCount == 0) return

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(20.dp),
        color = Color(0xF2081524),
        shadowElevation = 12.dp,
        border = BorderStroke(1.5.dp, GoldAccent.copy(alpha = 0.6f))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .horizontalScroll(rememberScrollState()),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                IconButton(
                    onClick = onCancel,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = stringResource(R.string.drive_action_cancel),
                        tint = TextSecondaryDark,
                        modifier = Modifier.size(18.dp)
                    )
                }

                Surface(
                    color = GoldAccent.copy(alpha = 0.15f),
                    shape = CircleShape
                ) {
                    Text(
                        text = "$selectedCount Dipilih",
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                        color = GoldAccent,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }

            // Clean-Copy Forward Button
            Surface(
                onClick = onCleanForward,
                shape = RoundedCornerShape(10.dp),
                color = MutedIceCyan.copy(alpha = 0.15f)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, null, tint = MutedIceCyan, modifier = Modifier.size(15.dp))
                    Text("Teruskan", color = MutedIceCyan, style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold))
                }
            }

            // Tag Category Button
            Surface(
                onClick = onTagCategory,
                shape = RoundedCornerShape(10.dp),
                color = SoftViolet.copy(alpha = 0.15f)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(Icons.Default.Label, null, tint = SoftViolet, modifier = Modifier.size(15.dp))
                    Text("Tag", color = SoftViolet, style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold))
                }
            }

            // Move Button
            Surface(
                onClick = onMove,
                shape = RoundedCornerShape(10.dp),
                color = Color(0x22FFFFFF)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(Icons.Default.DriveFileMove, null, tint = Color.White, modifier = Modifier.size(15.dp))
                    Text(stringResource(R.string.drive_action_move), color = Color.White, style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold))
                }
            }

            // Download Button
            Surface(
                onClick = onDownload,
                shape = RoundedCornerShape(10.dp),
                color = DustySage.copy(alpha = 0.15f)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(Icons.Default.Download, null, tint = DustySage, modifier = Modifier.size(15.dp))
                    Text(stringResource(R.string.drive_action_download), color = DustySage, style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold))
                }
            }

            // Delete Button
            IconButton(
                onClick = onDelete,
                modifier = Modifier.size(36.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Delete,
                    contentDescription = stringResource(R.string.drive_action_delete),
                    tint = SoftCoral,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}