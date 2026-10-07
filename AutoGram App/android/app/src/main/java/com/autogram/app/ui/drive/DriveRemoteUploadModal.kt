package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard

@Composable
fun DriveRemoteUploadModal(
    currentFolder: String,
    onDismiss: () -> Unit,
    onSubmitUrl: (url: String, stripCaption: Boolean, dedupCheck: Boolean) -> Unit
) {
    var urlInput by remember { mutableStateOf("") }
    var stripCaption by remember { mutableStateOf(true) }
    var dedupCheck by remember { mutableStateOf(true) }

    Dialog(onDismissRequest = onDismiss) {
        AutoGramGlassCard(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp),
            shape = RoundedCornerShape(20.dp),
            borderColor = BorderHairline,
            containerColor = SurfaceDeep
        ) {
            Column(
                modifier = Modifier.padding(6.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = MutedIceCyan.copy(alpha = 0.15f),
                            modifier = Modifier.size(36.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.Link, contentDescription = null, tint = MutedIceCyan, modifier = Modifier.size(20.dp))
                            }
                        }
                        Column {
                            Text(
                                text = stringResource(R.string.drive_remote_upload_title),
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                color = TextPrimaryDark
                            )
                            Text(
                                text = "Folder Tujuan: $currentFolder",
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = TextMutedDark
                            )
                        }
                    }
                    IconButton(onClick = onDismiss, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Default.Close, contentDescription = null, tint = TextMutedDark)
                    }
                }

                // URL Input Field
                OutlinedTextField(
                    value = urlInput,
                    onValueChange = { urlInput = it },
                    placeholder = { Text(stringResource(R.string.drive_remote_upload_hint), fontSize = 12.sp) },
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 2,
                    leadingIcon = {
                        Icon(Icons.Default.Link, contentDescription = null, tint = TextMutedDark, modifier = Modifier.size(18.dp))
                    }
                )

                // Clean Copy Toggles
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(stringResource(R.string.forwarder_strip_captions), style = MaterialTheme.typography.bodySmall, color = TextPrimaryDark)
                        Switch(checked = stripCaption, onCheckedChange = { stripCaption = it })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(stringResource(R.string.forwarder_dedup_check), style = MaterialTheme.typography.bodySmall, color = TextPrimaryDark)
                        Switch(checked = dedupCheck, onCheckedChange = { dedupCheck = it })
                    }
                }

                // Action Buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onDismiss,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, BorderHairline),
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 44.dp)
                    ) {
                        Text(stringResource(R.string.drive_action_cancel), color = TextSecondaryDark)
                    }

                    Button(
                        onClick = {
                            val trimmed = urlInput.trim()
                            if (trimmed.isNotBlank()) {
                                onSubmitUrl(trimmed, stripCaption, dedupCheck)
                            }
                        },
                        enabled = urlInput.trim().isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = MutedIceCyan, contentColor = SurfaceDeep),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .weight(1.5f)
                            .heightIn(min = 44.dp)
                    ) {
                        Icon(Icons.Default.CloudUpload, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.drive_remote_upload_action), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}
