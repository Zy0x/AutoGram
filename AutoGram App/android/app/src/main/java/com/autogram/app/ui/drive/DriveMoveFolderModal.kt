package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun DriveMoveFolderModal(
    selectedCount: Int,
    currentPath: String,
    onMove: (targetPath: String) -> Unit,
    onDismiss: () -> Unit
) {
    var targetPath by remember { mutableStateOf(if (currentPath == "/" || currentPath.isBlank()) "/Dokumen" else "/") }
    val defaultFolders = listOf("/", "/Dokumen", "/Media", "/Foto", "/Video", "/Arsip", "/Download")

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = SoftViolet.copy(alpha = 0.15f),
                modifier = Modifier.size(48.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.FolderOpen,
                        contentDescription = null,
                        tint = SoftViolet,
                        modifier = Modifier.size(26.dp)
                    )
                }
            }
        },
        title = {
            Text(
                text = stringResource(R.string.drive_move_title),
                style = MaterialTheme.typography.titleLarge.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp
                ),
                color = TextPrimaryDark
            )
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text(
                    text = stringResource(R.string.drive_move_select_target),
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondaryDark
                )

                // Current path indicator
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = SurfaceElevatedDark,
                    border = BorderStroke(1.dp, BorderHairline),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(Icons.Default.Folder, null, Modifier.size(16.dp), tint = TextMutedDark)
                        Text(
                            text = "Asal: $currentPath ($selectedCount berkas)",
                            style = MaterialTheme.typography.labelSmall,
                            color = TextMutedDark
                        )
                    }
                }

                // Preset destination chips
                Text(
                    text = "Pilih Cepat Folder Tujuan:",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = TextPrimaryDark
                )
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    items(defaultFolders) { folder ->
                        val isSelected = targetPath == folder
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (isSelected) MutedIceCyan.copy(alpha = 0.2f) else SurfaceElevatedDark,
                            border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
                            modifier = Modifier.clickable { targetPath = folder }
                        ) {
                            Text(
                                text = folder,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                ),
                                color = if (isSelected) MutedIceCyan else TextSecondaryDark
                            )
                        }
                    }
                }

                // Custom target path input
                OutlinedTextField(
                    value = targetPath,
                    onValueChange = { targetPath = it },
                    label = { Text("Jalur Folder Target") },
                    leadingIcon = { Icon(Icons.Default.CreateNewFolder, null, tint = MutedIceCyan) },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MutedIceCyan,
                        unfocusedBorderColor = BorderHairline,
                        focusedTextColor = TextPrimaryDark,
                        unfocusedTextColor = TextPrimaryDark
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onMove(targetPath.trim())
                    onDismiss()
                },
                enabled = targetPath.isNotBlank() && targetPath != currentPath,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MutedIceCyan,
                    contentColor = SurfaceDeep
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.heightIn(min = 44.dp)
            ) {
                Text(
                    text = stringResource(R.string.drive_move_here),
                    fontWeight = FontWeight.Bold
                )
            }
        },
        dismissButton = {
            OutlinedButton(
                onClick = onDismiss,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.heightIn(min = 44.dp)
            ) {
                Text(stringResource(R.string.drive_action_cancel))
            }
        },
        shape = RoundedCornerShape(20.dp),
        containerColor = SurfaceDeep
    )
}
