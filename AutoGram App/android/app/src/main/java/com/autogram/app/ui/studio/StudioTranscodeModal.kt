package com.autogram.app.ui.studio

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

@Composable
fun StudioTranscodeModal(
    selectedCount: Int,
    onDismiss: () -> Unit,
    onStartTranscode: () -> Unit = {}
) {
    var selectedCodec by remember { mutableStateOf("H.265 / HEVC") }
    var selectedResolution by remember { mutableStateOf("Full HD (1080p)") }
    var audioNormEnabled by remember { mutableStateOf(true) }
    var autoSplitEnabled by remember { mutableStateOf(true) }

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
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // 1. TOP HEADER
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
                            text = stringResource(R.string.studio_transcode_title),
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            ),
                            color = Color.White
                        )
                    }

                    Surface(
                        color = GoldAccent.copy(alpha = 0.15f),
                        shape = CircleShape,
                        border = BorderStroke(0.5.dp, GoldAccent.copy(alpha = 0.4f))
                    ) {
                        Text(
                            text = stringResource(R.string.studio_selected_counter, selectedCount),
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, fontSize = 10.5.sp),
                            color = GoldAccent
                        )
                    }
                }

                // 2. SUMMARY CARD
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = Color(0xF00B1C30),
                    border = BorderStroke(1.dp, MutedIceCyan.copy(alpha = 0.3f))
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = MutedIceCyan.copy(alpha = 0.15f),
                            modifier = Modifier.size(40.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.AutoAwesome, null, tint = MutedIceCyan, modifier = Modifier.size(20.dp))
                            }
                        }

                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Akselerasi Transcode Hardware",
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                color = TextPrimaryDark
                            )
                            Text(
                                text = "GPU NVENC / MediaCodec • Hemat ~50% Bandwidth Cloud",
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = MutedIceCyan
                            )
                        }
                    }
                }

                // 3. TARGET CODEC SELECTOR
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.studio_codec_label),
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = TextPrimaryDark
                    )
                    listOf("H.264 (Universil)", "H.265 / HEVC", "AV1 (Ultra-Modern)").forEach { codec ->
                        Surface(
                            onClick = { selectedCodec = codec },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                            color = if (selectedCodec == codec) GoldAccent.copy(alpha = 0.12f) else CardNavyBg,
                            border = BorderStroke(1.dp, if (selectedCodec == codec) GoldAccent else CardNavyBorder)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = codec,
                                    style = MaterialTheme.typography.bodySmall.copy(
                                        fontWeight = if (selectedCodec == codec) FontWeight.Bold else FontWeight.Medium
                                    ),
                                    color = if (selectedCodec == codec) GoldAccent else TextPrimaryDark
                                )
                                RadioButton(
                                    selected = selectedCodec == codec,
                                    onClick = { selectedCodec = codec },
                                    colors = RadioButtonDefaults.colors(selectedColor = GoldAccent)
                                )
                            }
                        }
                    }
                }

                // 4. RESOLUTION SELECTOR
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.studio_resolution_label),
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = TextPrimaryDark
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf("4K UHD", "Full HD (1080p)", "HD (720p)").forEach { res ->
                            Surface(
                                onClick = { selectedResolution = res },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(10.dp),
                                color = if (selectedResolution == res) MutedIceCyan.copy(alpha = 0.15f) else CardNavyBg,
                                border = BorderStroke(1.dp, if (selectedResolution == res) MutedIceCyan else CardNavyBorder)
                            ) {
                                Column(
                                    modifier = Modifier.padding(vertical = 10.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    Text(
                                        text = res,
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontWeight = if (selectedResolution == res) FontWeight.Bold else FontWeight.Medium,
                                            fontSize = 10.5.sp
                                        ),
                                        color = if (selectedResolution == res) MutedIceCyan else TextPrimaryDark
                                    )
                                }
                            }
                        }
                    }
                }

                // 5. ADVANCED AUDIO & SPLIT TOGGLES
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = CardNavyBg,
                    border = BorderStroke(1.dp, CardNavyBorder)
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = stringResource(R.string.studio_audio_norm),
                                style = MaterialTheme.typography.bodySmall,
                                color = TextPrimaryDark
                            )
                            Switch(
                                checked = audioNormEnabled,
                                onCheckedChange = { audioNormEnabled = it },
                                colors = SwitchDefaults.colors(checkedThumbColor = GoldAccent)
                            )
                        }

                        HorizontalDivider(color = Color(0x14FFFFFF))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = stringResource(R.string.studio_auto_split),
                                style = MaterialTheme.typography.bodySmall,
                                color = TextPrimaryDark
                            )
                            Switch(
                                checked = autoSplitEnabled,
                                onCheckedChange = { autoSplitEnabled = it },
                                colors = SwitchDefaults.colors(checkedThumbColor = GoldAccent)
                            )
                        }
                    }
                }

                // 6. ACTION CTA BUTTON
                Button(
                    onClick = {
                        onStartTranscode()
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
                    Icon(Icons.Default.PlayCircleFilled, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = stringResource(R.string.studio_action_start_transcode),
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold)
                    )
                }

                Spacer(Modifier.height(30.dp))
            }
        }
    }
}