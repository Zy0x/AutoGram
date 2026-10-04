package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

private data class TopicColorPreset(val hex: String, val color: Color)

@Composable
fun DriveCreateTopicModal(
    onDismiss: () -> Unit,
    onCreateTopic: (title: String, colorHex: String?, iconEmoji: String?) -> Unit
) {
    var topicTitle by remember { mutableStateOf("") }
    var selectedColorHex by remember { mutableStateOf("#6FB9F0") } // Default Telegram Sky Blue
    var selectedEmoji by remember { mutableStateOf("📁") }

    val topicColors = remember {
        listOf(
            TopicColorPreset("#6FB9F0", Color(0xFF6FB9F0)), // Sky Blue
            TopicColorPreset("#FFD67E", Color(0xFFFFD67E)), // Amber Gold
            TopicColorPreset("#CB86DB", Color(0xFFCB86DB)), // Amethyst
            TopicColorPreset("#8EEE98", Color(0xFF8EEE98)), // Mint Green
            TopicColorPreset("#FF93B2", Color(0xFFFF93B2)), // Rose Pink
            TopicColorPreset("#FB6F5F", Color(0xFFFB6F5F))  // Coral
        )
    }

    val emojiPresets = remember {
        listOf("📁", "🎬", "🎵", "📝", "💡", "📌", "🔒", "⭐", "📦", "🚀", "💬", "🛠️")
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SurfaceDeep,
        icon = {
            Surface(
                shape = CircleShape,
                color = GoldAccent.copy(alpha = 0.15f),
                modifier = Modifier.size(52.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.Forum,
                        contentDescription = null,
                        tint = GoldAccent,
                        modifier = Modifier.size(26.dp)
                    )
                }
            }
        },
        title = {
            Text(
                text = stringResource(R.string.drive_create_topic_title),
                style = MaterialTheme.typography.titleMedium.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp
                ),
                color = TextPrimaryDark
            )
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = stringResource(R.string.drive_create_topic_subtitle),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                    color = TextSecondaryDark
                )

                // Topic Title Input
                OutlinedTextField(
                    value = topicTitle,
                    onValueChange = { topicTitle = it },
                    placeholder = {
                        Text(
                            text = stringResource(R.string.drive_create_topic_placeholder),
                            fontSize = 13.sp
                        )
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = SurfaceDark,
                        unfocusedContainerColor = SurfaceDark,
                        focusedBorderColor = GoldAccent,
                        unfocusedBorderColor = BorderHairline,
                        focusedTextColor = TextPrimaryDark,
                        unfocusedTextColor = TextPrimaryDark
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                // Emoji Chip Selector
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.drive_create_topic_icon_label),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 11.sp
                        ),
                        color = GoldAccent
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        emojiPresets.forEach { emoji ->
                            val isSelected = selectedEmoji == emoji
                            Surface(
                                onClick = { selectedEmoji = emoji },
                                shape = RoundedCornerShape(10.dp),
                                color = if (isSelected) GoldAccent.copy(alpha = 0.25f) else SurfaceElevatedDark,
                                border = BorderStroke(1.dp, if (isSelected) GoldAccent else BorderHairline),
                                modifier = Modifier.size(38.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(text = emoji, fontSize = 18.sp)
                                }
                            }
                        }
                    }
                }

                // Topic Color Selector
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.drive_create_topic_color_label),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 11.sp
                        ),
                        color = GoldAccent
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        topicColors.forEach { preset ->
                            val isSelected = selectedColorHex == preset.hex
                            Box(
                                modifier = Modifier
                                    .size(34.dp)
                                    .clip(CircleShape)
                                    .clickable { selectedColorHex = preset.hex },
                                contentAlignment = Alignment.Center
                            ) {
                                Surface(
                                    shape = CircleShape,
                                    color = preset.color,
                                    border = if (isSelected) BorderStroke(2.5.dp, Color.White) else null,
                                    modifier = Modifier.fillMaxSize()
                                ) {
                                    if (isSelected) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Icon(
                                                imageVector = Icons.Default.Check,
                                                contentDescription = null,
                                                tint = Color.Black,
                                                modifier = Modifier.size(16.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val trimmed = topicTitle.trim()
                    if (trimmed.isNotBlank()) {
                        onCreateTopic(trimmed, selectedColorHex, selectedEmoji)
                        onDismiss()
                    }
                },
                enabled = topicTitle.trim().isNotBlank(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = GoldAccent,
                    contentColor = Color.Black
                ),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(
                    text = stringResource(R.string.drive_action_create_topic),
                    fontWeight = FontWeight.Bold
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(
                    text = stringResource(R.string.drive_action_cancel),
                    color = TextSecondaryDark
                )
            }
        }
    )
}
