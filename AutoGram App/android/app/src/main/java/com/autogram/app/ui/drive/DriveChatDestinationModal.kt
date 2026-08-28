package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.StatusPill

@Composable
fun DriveChatDestinationModal(
    selectedTarget: String = "Saved Messages",
    onDismiss: () -> Unit,
    onSelectTarget: (String) -> Unit = {}
) {
    var target by remember { mutableStateOf(selectedTarget) }
    var customChatId by remember { mutableStateOf("") }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(CanvasDeepNavy.copy(alpha = 0.96f))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .padding(horizontal = 20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        IconButton(
                            onClick = onDismiss,
                            modifier = Modifier
                                .size(36.dp)
                                .background(Color(0x22FFFFFF), CircleShape)
                        ) {
                            Icon(Icons.Default.Close, null, tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                        Text(
                            text = stringResource(R.string.drive_dest_title),
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            ),
                            color = Color.White
                        )
                    }

                    StatusPill(text = "MTProto Peer", color = MutedIceCyan, isLive = true)
                }

                // Preset Channels
                listOf(
                    stringResource(R.string.drive_dest_saved) to Icons.Default.Bookmark,
                    stringResource(R.string.drive_dest_vip) to Icons.Default.Verified,
                    stringResource(R.string.drive_dest_custom) to Icons.Default.Tag
                ).forEach { (name, icon) ->
                    val isChosen = target == name
                    Surface(
                        onClick = { target = name },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = if (isChosen) GoldAccent.copy(alpha = 0.12f) else CardNavyBg,
                        border = BorderStroke(1.dp, if (isChosen) GoldAccent else CardNavyBorder)
                    ) {
                        Row(
                            modifier = Modifier.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Surface(
                                shape = CircleShape,
                                color = if (isChosen) GoldAccent.copy(alpha = 0.2f) else Color(0x22FFFFFF),
                                modifier = Modifier.size(36.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        imageVector = icon,
                                        contentDescription = null,
                                        tint = if (isChosen) GoldAccent else TextSecondaryDark,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }

                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = name,
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = if (isChosen) GoldAccent else TextPrimaryDark
                                )
                            }

                            RadioButton(
                                selected = isChosen,
                                onClick = { target = name },
                                colors = RadioButtonDefaults.colors(selectedColor = GoldAccent)
                            )
                        }
                    }
                }

                // Custom Chat ID input if custom is selected
                if (target == stringResource(R.string.drive_dest_custom)) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            text = "Chat / Channel ID",
                            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                            color = TextPrimaryDark
                        )
                        OutlinedTextField(
                            value = customChatId,
                            onValueChange = { customChatId = it },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = GoldAccent,
                                unfocusedBorderColor = CardNavyBorder,
                                focusedTextColor = Color.White,
                                unfocusedTextColor = Color.White
                            ),
                            placeholder = { Text(stringResource(R.string.drive_dest_custom_hint), color = TextMutedDark) },
                            singleLine = true
                        )
                    }
                }

                // Apply CTA Button
                Button(
                    onClick = {
                        val finalTarget = if (target == "Kanal / Grup Kustom" && customChatId.isNotBlank()) customChatId else target
                        onSelectTarget(finalTarget)
                        onDismiss()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = GoldAccent,
                        contentColor = CanvasDeepNavy
                    )
                ) {
                    Icon(Icons.Default.Check, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = stringResource(R.string.drive_dest_apply),
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold)
                    )
                }

                Spacer(Modifier.height(30.dp))
            }
        }
    }
}