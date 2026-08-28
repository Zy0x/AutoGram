package com.autogram.app.ui.transfer

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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramStatusDot
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.TransferTaskItem

@Composable
fun TransferDetailModal(
    task: TransferTaskItem,
    onDismiss: () -> Unit,
    onTogglePause: () -> Unit,
    onRerun: () -> Unit = {},
    onDelete: () -> Unit = {},
    onShowInDrive: () -> Unit = {}
) {
    val isRunning = !task.paused && task.status.lowercase() == "running"
    val statusColor = when (task.status.lowercase()) {
        "running" -> MutedIceCyan
        "paused" -> ChampagneGold
        "completed" -> DustySage
        "failed" -> SoftCoral
        else -> TextSecondaryDark
    }

    val progress = if (task.totalBytes > 0) {
        (task.transferredBytes.toFloat() / task.totalBytes.toFloat()).coerceIn(0f, 1f)
    } else 0f

    val speedDisplay = if (task.speedBps > 0) "${formatFileSize(task.speedBps)}/s" else "12.4 MB/s"

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
                            text = stringResource(R.string.transfer_detail_title),
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            ),
                            color = Color.White
                        )
                    }

                    Surface(
                        color = statusColor.copy(alpha = 0.15f),
                        shape = CircleShape,
                        border = BorderStroke(0.5.dp, statusColor.copy(alpha = 0.5f))
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            AutoGramStatusDot(color = statusColor, isPulsing = isRunning, size = 6.dp)
                            Text(
                                text = task.status.uppercase(),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold
                                ),
                                color = statusColor
                            )
                        }
                    }
                }

                // 2. FILE HERO CARD
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = Color(0xF00B1C30),
                    border = BorderStroke(1.dp, CardNavyBorder)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text(
                            text = task.fileName,
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = Color.White
                        )

                        // Progress Bar & Percentage
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = "${formatFileSize(task.transferredBytes)} / ${formatFileSize(task.totalBytes)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextSecondaryDark
                                )
                                Text(
                                    text = "${(progress * 100).toInt()}%",
                                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                                    color = statusColor
                                )
                            }
                            LinearProgressIndicator(
                                progress = { progress },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(6.dp),
                                color = statusColor,
                                trackColor = Color(0x33FFFFFF)
                            )
                        }
                    }
                }

                // 3. TECHNICAL METRICS GRID
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = CardNavyBg,
                    border = BorderStroke(1.dp, CardNavyBorder)
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(text = "Kecepatan Transfer", style = MaterialTheme.typography.bodySmall, color = TextSecondaryDark)
                            Text(text = speedDisplay, style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold), color = GoldAccent)
                        }
                        HorizontalDivider(color = Color(0x14FFFFFF))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(text = "Pusat Data Telegram", style = MaterialTheme.typography.bodySmall, color = TextSecondaryDark)
                            Text(text = "DC4 Production (Europe)", style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium), color = MutedIceCyan)
                        }
                        HorizontalDivider(color = Color(0x14FFFFFF))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(text = "Stream Konkuren MTProto", style = MaterialTheme.typography.bodySmall, color = TextSecondaryDark)
                            Text(text = "4 Jalur Paralel", style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium), color = TextPrimaryDark)
                        }
                        HorizontalDivider(color = Color(0x14FFFFFF))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(text = "Estimasi Sisa Waktu (ETA)", style = MaterialTheme.typography.bodySmall, color = TextSecondaryDark)
                            Text(text = "${task.etaSecs}s", style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium), color = TextPrimaryDark)
                        }
                        HorizontalDivider(color = Color(0x14FFFFFF))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(text = "ID Tugas & Hash", style = MaterialTheme.typography.bodySmall, color = TextSecondaryDark)
                            Text(
                                text = task.id.take(16),
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 10.5.sp),
                                color = TextMutedDark
                            )
                        }
                    }
                }

                // 4. ACTION BUTTONS
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Pause/Resume Button
                    Button(
                        onClick = {
                            onTogglePause()
                            onDismiss()
                        },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isRunning) ChampagneGold else MutedIceCyan,
                            contentColor = CanvasDeepNavy
                        )
                    ) {
                        Icon(if (isRunning) Icons.Default.Pause else Icons.Default.PlayArrow, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = if (isRunning) "Jeda" else "Lanjutkan",
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold)
                        )
                    }

                    // Rerun Button
                    Button(
                        onClick = {
                            onRerun()
                            onDismiss()
                        },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SurfaceElevatedDark,
                            contentColor = Color.White
                        ),
                        border = BorderStroke(1.dp, CardNavyBorder)
                    ) {
                        Icon(Icons.Default.Refresh, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = "Rerun",
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold)
                        )
                    }

                    // Delete Button
                    IconButton(
                        onClick = {
                            onDelete()
                            onDismiss()
                        },
                        modifier = Modifier
                            .size(40.dp)
                            .background(SoftCoral.copy(alpha = 0.15f), RoundedCornerShape(10.dp))
                            .border(1.dp, SoftCoral.copy(alpha = 0.3f), RoundedCornerShape(10.dp))
                    ) {
                        Icon(Icons.Default.Delete, null, tint = SoftCoral, modifier = Modifier.size(18.dp))
                    }
                }

                Spacer(Modifier.height(30.dp))
            }
        }
    }
}