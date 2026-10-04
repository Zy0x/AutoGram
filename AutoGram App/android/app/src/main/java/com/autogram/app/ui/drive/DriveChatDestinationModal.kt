package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
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
import com.autogram.app.features.cloud.CloudLocation
import com.autogram.app.theme.*

@Composable
fun DriveChatDestinationModal(
    selectedCount: Int = 1,
    locations: List<CloudLocation> = emptyList(),
    onForward: (targetPeerId: String, cleanCopy: Boolean) -> Unit = { _, _ -> },
    onDismiss: () -> Unit
) {
    var selectedTarget by remember { mutableStateOf("me") }
    var cleanCopy by remember { mutableStateOf(true) }
    var customChatId by remember { mutableStateOf("") }
    var isCustomMode by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = DustySage.copy(alpha = 0.15f),
                modifier = Modifier.size(48.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.Send,
                        contentDescription = null,
                        tint = DustySage,
                        modifier = Modifier.size(24.dp)
                    )
                }
            }
        },
        title = {
            Text(
                text = stringResource(R.string.drive_dest_title),
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
                    text = "Teruskan $selectedCount berkas ke percakapan Telegram:",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondaryDark
                )

                // Clean copy toggle
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = SurfaceElevatedDark,
                    border = BorderStroke(1.dp, BorderHairline),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                text = "Salin Bersih (Clean Copy)",
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = TextPrimaryDark
                            )
                            Text(
                                text = "Kirim tanpa tanda 'Diteruskan dari' untuk privasi maksimal",
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = TextMutedDark
                            )
                        }
                        Switch(
                            checked = cleanCopy,
                            onCheckedChange = { cleanCopy = it },
                            colors = SwitchDefaults.colors(
                                checkedThumbColor = Color.White,
                                checkedTrackColor = MutedIceCyan
                            )
                        )
                    }
                }

                // Preset destination options
                Text(
                    text = "Pilih Tujuan:",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = TextPrimaryDark
                )

                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Option 1: Saved Messages
                    val isSavedSelected = !isCustomMode && selectedTarget == "me"
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (isSavedSelected) MutedIceCyan.copy(alpha = 0.15f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isSavedSelected) MutedIceCyan else BorderHairline),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                isCustomMode = false
                                selectedTarget = "me"
                            }
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Icon(Icons.Default.Bookmark, null, tint = if (isSavedSelected) MutedIceCyan else TextMutedDark)
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = stringResource(R.string.drive_dest_saved),
                                    style = MaterialTheme.typography.bodyMedium.copy(
                                        fontWeight = if (isSavedSelected) FontWeight.Bold else FontWeight.Normal
                                    ),
                                    color = if (isSavedSelected) MutedIceCyan else TextPrimaryDark
                                )
                            }
                            if (isSavedSelected) Icon(Icons.Default.Check, null, tint = MutedIceCyan, modifier = Modifier.size(18.dp))
                        }
                    }

                    // Available dialog locations if any
                    locations.take(4).forEach { loc ->
                        val isLocSelected = !isCustomMode && selectedTarget == loc.id
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = if (isLocSelected) MutedIceCyan.copy(alpha = 0.15f) else SurfaceElevatedDark,
                            border = BorderStroke(1.dp, if (isLocSelected) MutedIceCyan else BorderHairline),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    isCustomMode = false
                                    selectedTarget = loc.id
                                }
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(
                                    if (loc.kind == "channel") Icons.Default.Campaign else Icons.Default.Group,
                                    null,
                                    tint = if (isLocSelected) MutedIceCyan else TextMutedDark
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = loc.title,
                                        style = MaterialTheme.typography.bodyMedium.copy(
                                            fontWeight = if (isLocSelected) FontWeight.Bold else FontWeight.Normal
                                        ),
                                        color = if (isLocSelected) MutedIceCyan else TextPrimaryDark,
                                        maxLines = 1
                                    )
                                }
                                if (isLocSelected) Icon(Icons.Default.Check, null, tint = MutedIceCyan, modifier = Modifier.size(18.dp))
                            }
                        }
                    }

                    // Option Custom ID
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (isCustomMode) MutedIceCyan.copy(alpha = 0.15f) else SurfaceElevatedDark,
                        border = BorderStroke(1.dp, if (isCustomMode) MutedIceCyan else BorderHairline),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { isCustomMode = true }
                    ) {
                        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(Icons.Default.Tag, null, tint = if (isCustomMode) MutedIceCyan else TextMutedDark)
                                Text(
                                    text = stringResource(R.string.drive_dest_custom),
                                    style = MaterialTheme.typography.bodyMedium.copy(
                                        fontWeight = if (isCustomMode) FontWeight.Bold else FontWeight.Normal
                                    ),
                                    color = if (isCustomMode) MutedIceCyan else TextPrimaryDark
                                )
                            }
                            if (isCustomMode) {
                                OutlinedTextField(
                                    value = customChatId,
                                    onValueChange = { customChatId = it },
                                    placeholder = { Text(stringResource(R.string.drive_dest_custom_hint)) },
                                    singleLine = true,
                                    shape = RoundedCornerShape(8.dp),
                                    colors = OutlinedTextFieldDefaults.colors(
                                        focusedBorderColor = MutedIceCyan,
                                        unfocusedBorderColor = BorderHairline,
                                        focusedTextColor = TextPrimaryDark,
                                        unfocusedTextColor = TextPrimaryDark
                                    ),
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            val finalTarget = if (isCustomMode) customChatId.trim() else selectedTarget
            Button(
                onClick = {
                    onForward(finalTarget, cleanCopy)
                    onDismiss()
                },
                enabled = finalTarget.isNotBlank(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = DustySage,
                    contentColor = SurfaceDeep
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.heightIn(min = 44.dp)
            ) {
                Text(
                    text = stringResource(R.string.drive_dest_apply),
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
