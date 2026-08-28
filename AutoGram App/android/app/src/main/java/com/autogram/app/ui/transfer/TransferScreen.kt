package com.autogram.app.ui.transfer

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.ripple.rememberRipple
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramStatusDot
import com.autogram.app.ui.components.AutoGramSurface
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.*

@Composable
fun TransferScreen(
    viewModel: TransferViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    TransferScreenContent(
        state = state,
        modifier = modifier,
        onTogglePause = { task -> viewModel.togglePause(task) },
        onPauseAll = { viewModel.pauseAll() },
        onCancelAll = { viewModel.cancelAll() },
        onClearCompleted = { viewModel.clearCompleted() }
    )
}

@Composable
fun TransferScreenContent(
    state: TransferUiState,
    modifier: Modifier = Modifier,
    onTogglePause: (TransferTaskItem) -> Unit = {},
    onPauseAll: () -> Unit = {},
    onCancelAll: () -> Unit = {},
    onClearCompleted: () -> Unit = {}
) {
    var selectedTab by remember { mutableStateOf(0) } // 0 = Aktif, 1 = Riwayat

    AutoGramSurface(modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
        ) {
            // =========================================================================
            // TOP APP BAR (Matching Stitch Screen: Transfer Manager Compact Stream)
            // =========================================================================
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
                    .background(Color(0xD9031427))
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Left: Cyan Dot + Title + Active Badge + MTProto Safe
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    AutoGramStatusDot(color = MutedIceCyan, isPulsing = true, size = 7.dp)
                    Text(
                        text = stringResource(R.string.transfer_title),
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.5.sp
                        ),
                        color = TextPrimaryDark
                    )
                    Surface(
                        color = MutedIceCyan.copy(alpha = 0.15f),
                        shape = CircleShape,
                        border = BorderStroke(0.5.dp, MutedIceCyan.copy(alpha = 0.35f))
                    ) {
                        Text(
                            text = "${state.activeTasks.size} Berjalan",
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 10.sp,
                                fontWeight = FontWeight.SemiBold
                            ),
                            color = MutedIceCyan
                        )
                    }
                }

                // Right: Segmented Toggle (Aktif / Riwayat) + Clear Button
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = CardNavyBg,
                        border = BorderStroke(1.dp, CardNavyBorder)
                    ) {
                        Row(modifier = Modifier.padding(2.dp)) {
                            // Tab 0: Aktif
                            Surface(
                                shape = RoundedCornerShape(6.dp),
                                color = if (selectedTab == 0) SurfaceElevatedDark else Color.Transparent,
                                modifier = Modifier.clickable { selectedTab = 0 }
                            ) {
                                Text(
                                    text = "Aktif (${state.activeTasks.size})",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 10.5.sp,
                                        fontWeight = if (selectedTab == 0) FontWeight.Bold else FontWeight.Medium
                                    ),
                                    color = if (selectedTab == 0) GoldAccent else TextSecondaryDark
                                )
                            }
                            // Tab 1: Riwayat
                            Surface(
                                shape = RoundedCornerShape(6.dp),
                                color = if (selectedTab == 1) SurfaceElevatedDark else Color.Transparent,
                                modifier = Modifier.clickable { selectedTab = 1 }
                            ) {
                                Text(
                                    text = "Riwayat (${state.completedTasks.size})",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 10.5.sp,
                                        fontWeight = if (selectedTab == 1) FontWeight.Bold else FontWeight.Medium
                                    ),
                                    color = if (selectedTab == 1) GoldAccent else TextSecondaryDark
                                )
                            }
                        }
                    }

                    Box(
                        modifier = Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = rememberRipple(bounded = true, color = GoldAccent)
                            ) { onClearCompleted() },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.ClearAll,
                            contentDescription = stringResource(R.string.transfer_action_clear_all),
                            tint = TextSecondaryDark,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }

            // =========================================================================
            // SCROLLABLE STREAM CONTENT
            // =========================================================================
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .widthIn(max = 680.dp)
                    .padding(horizontal = 16.dp),
                contentPadding = PaddingValues(top = 10.dp, bottom = 100.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 1. MASTER TELEMETRY CARD (DOUBLE-BEZEL GLASS)
                item {
                    MasterTelemetryCard(
                        aggregateProgress = state.aggregateProgress,
                        activeCount = state.activeTasks.size,
                        totalSpeedBps = state.activeTasks.sumOf { it.speedBps },
                        onPauseAll = onPauseAll,
                        onCancelAll = onCancelAll
                    )
                }

                // 2. ACTIVE QUEUE SECTION (ULTRA-COMPACT CARDS)
                if (selectedTab == 0) {
                    item {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 4.dp, bottom = 2.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Antrean Aktif (${state.activeTasks.size})",
                                style = MaterialTheme.typography.titleSmall.copy(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 13.sp
                                ),
                                color = TextPrimaryDark
                            )
                            Text(
                                text = stringResource(R.string.transfer_mtproto_safe),
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                color = MutedIceCyan
                            )
                        }
                    }

                    items(state.activeTasks, key = { it.id }) { task ->
                        CompactQueueItemCard(
                            task = task,
                            onTogglePause = { onTogglePause(task) },
                            onCancel = { /* Cancel single task */ }
                        )
                    }
                }

                // 3. RECENTLY COMPLETED SECTION
                if (state.completedTasks.isNotEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.transfer_section_history).uppercase(),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.8.sp
                            ),
                            color = TextSecondaryDark,
                            modifier = Modifier.padding(top = 8.dp, bottom = 2.dp)
                        )
                    }

                    items(state.completedTasks, key = { it.id }) { task ->
                        CompactHistoryItemRow(task = task)
                    }
                }
            }
        }
    }
}

@Composable
fun MasterTelemetryCard(
    aggregateProgress: Float,
    activeCount: Int,
    totalSpeedBps: Long,
    onPauseAll: () -> Unit,
    onCancelAll: () -> Unit
) {
    val animatedProgress by animateFloatAsState(
        targetValue = aggregateProgress,
        animationSpec = tween(durationMillis = 600, easing = FastOutSlowInEasing),
        label = "TelemetryProgress"
    )

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = Color(0xE6102034),
        border = BorderStroke(1.dp, Color(0x26FFFFFF)),
        shadowElevation = 8.dp
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Top Row: Radial Ring + Percentage + Target + Speed
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Radial Progress Ring
                Box(
                    modifier = Modifier.size(58.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Canvas(modifier = Modifier.fillMaxSize()) {
                        val strokeWidth = 5.dp.toPx()
                        // Track
                        drawCircle(
                            color = Color(0x3326364A),
                            style = Stroke(width = strokeWidth)
                        )
                        // Progress
                        drawArc(
                            color = MutedIceCyan,
                            startAngle = -90f,
                            sweepAngle = animatedProgress * 360f,
                            useCenter = false,
                            style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
                        )
                    }
                    Icon(
                        imageVector = Icons.Default.CloudUpload,
                        contentDescription = null,
                        tint = MutedIceCyan,
                        modifier = Modifier.size(24.dp)
                    )
                }

                // Percentage & Destination
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = String.format(java.util.Locale.US, "%.1f%%", animatedProgress * 100),
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Bold
                        ),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = "Ke Saved Messages",
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                        color = TextSecondaryDark
                    )
                }

                // Live Speed Pill (Ice Cyan)
                Surface(
                    color = MutedIceCyan.copy(alpha = 0.12f),
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, MutedIceCyan.copy(alpha = 0.3f))
                ) {
                    Text(
                        text = if (totalSpeedBps > 0) "${formatFileSize(totalSpeedBps)}/s" else "18.6 MB/s",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        style = MaterialTheme.typography.labelMedium.copy(
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        ),
                        color = MutedIceCyan
                    )
                }
            }

            // Multi-Stage Glowing Linear Progress Bar
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "Total Progress",
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                        color = TextSecondaryDark
                    )
                    Text(
                        text = "$activeCount antrean",
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                        color = MutedIceCyan
                    )
                }

                // Multi-stage bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .clip(CircleShape)
                        .background(Color(0x3326364A))
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .weight(0.52f)
                            .background(MutedIceCyan)
                    )
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .weight(0.24f)
                            .background(GoldAccent)
                    )
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .weight(0.24f)
                            .background(Color(0x26FFFFFF))
                    )
                }
            }

            // 2x2 Metric Grid
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                MetricCell(label = "Puncak", value = "24.2 MB/s", isMono = true, modifier = Modifier.weight(1f))
                MetricCell(label = "ETA", value = "00:34", isMono = true, valueColor = GoldAccent, modifier = Modifier.weight(1f))
                MetricCell(label = "Volume", value = "1.45 / 1.94 GB", isMono = true, modifier = Modifier.weight(1f))
                MetricCell(label = "Target", value = "→ Saved", modifier = Modifier.weight(1f))
            }

            // Control Buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Jeda Semua
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .height(34.dp)
                        .clip(CircleShape)
                        .clickable { onPauseAll() },
                    shape = CircleShape,
                    color = CardNavyBg,
                    border = BorderStroke(1.dp, CardNavyBorder)
                ) {
                    Row(
                        modifier = Modifier.fillMaxSize(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Pause, null, tint = TextPrimaryDark, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = stringResource(R.string.transfer_action_pause_all),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = TextPrimaryDark
                        )
                    }
                }

                // Batalkan
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .height(34.dp)
                        .clip(CircleShape)
                        .clickable { onCancelAll() },
                    shape = CircleShape,
                    color = SoftCoral.copy(alpha = 0.12f),
                    border = BorderStroke(1.dp, SoftCoral.copy(alpha = 0.3f))
                ) {
                    Row(
                        modifier = Modifier.fillMaxSize(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Cancel, null, tint = SoftCoral, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = stringResource(R.string.transfer_action_cancel_all),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = SoftCoral
                        )
                    }
                }

                // Buka Folder
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .height(34.dp)
                        .clip(CircleShape)
                        .clickable { /* Open Folder */ },
                    shape = CircleShape,
                    color = GoldAccent.copy(alpha = 0.12f),
                    border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.3f))
                ) {
                    Row(
                        modifier = Modifier.fillMaxSize(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.FolderOpen, null, tint = GoldAccent, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = stringResource(R.string.transfer_action_open_folder),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = GoldAccent
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun MetricCell(
    label: String,
    value: String,
    isMono: Boolean = false,
    valueColor: Color = TextPrimaryDark,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = CardNavyBg,
        border = BorderStroke(1.dp, Color(0x1AFFFFFF))
    ) {
        Column(modifier = Modifier.padding(horizontal = 6.dp, vertical = 5.dp)) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                color = TextSecondaryDark
            )
            Text(
                text = value,
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = if (isMono) FontFamily.Monospace else FontFamily.Default
                ),
                color = valueColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
fun CompactQueueItemCard(
    task: TransferTaskItem,
    onTogglePause: () -> Unit,
    onCancel: () -> Unit
) {
    val isVideo = task.fileName.endsWith(".mp4", ignoreCase = true)
    val isZip = task.fileName.endsWith(".zip", ignoreCase = true)
    val isAudio = task.fileName.endsWith(".wav", ignoreCase = true) || task.fileName.endsWith(".mp3", ignoreCase = true)

    val progress = if (task.totalBytes > 0) {
        (task.transferredBytes.toFloat() / task.totalBytes.toFloat()).coerceIn(0f, 1f)
    } else if (task.stage == "upload") 0.82f else if (task.stage == "reencode") 0.52f else 0f

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = Color(0xE6102034),
        border = BorderStroke(1.dp, Color(0x1FFFFFFF))
    ) {
        Row(
            modifier = Modifier.padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Thumbnail / Icon Box
            Box(
                modifier = Modifier
                    .size(46.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (isZip) GoldAccent.copy(alpha = 0.15f) else Color(0xFF1B2B3F))
                    .border(
                        1.dp,
                        if (isZip) GoldAccent.copy(alpha = 0.35f) else Color(0x26FFFFFF),
                        RoundedCornerShape(8.dp)
                    ),
                contentAlignment = Alignment.Center
            ) {
                if (isVideo) {
                    Icon(Icons.Default.Movie, null, tint = MutedIceCyan, modifier = Modifier.size(22.dp))
                    Surface(
                        color = Color(0xCC000000),
                        shape = RoundedCornerShape(3.dp),
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(2.dp)
                    ) {
                        Text(
                            text = "4K",
                            modifier = Modifier.padding(horizontal = 2.dp),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 7.sp, fontWeight = FontWeight.Bold),
                            color = Color.White
                        )
                    }
                } else if (isZip) {
                    Icon(Icons.Default.FolderZip, null, tint = GoldAccent, modifier = Modifier.size(24.dp))
                } else {
                    Icon(Icons.Default.AudioFile, null, tint = TextSecondaryDark, modifier = Modifier.size(22.dp))
                }
            }

            // Info & Progress
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = task.fileName,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.5.sp
                    ),
                    color = TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                // Subtitle metadata
                val subtitle = when {
                    isVideo -> "840 MB → ~290 MB (-65%) · NVENC H.265 (60 FPS)"
                    isZip -> "Transcoding 2.4x Speed · GPU Accelerated"
                    else -> "Menunggu Antrean (Antre #3) · → Channel VIP"
                }
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp),
                    color = TextSecondaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(Modifier.height(4.dp))

                // Progress Bar & Speed
                if (progress > 0f) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .height(4.dp)
                                .clip(CircleShape)
                                .background(Color(0x3326364A))
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxHeight()
                                    .fillMaxWidth(progress)
                                    .background(if (isZip) GoldAccent else MutedIceCyan)
                            )
                        }

                        if (task.speedBps > 0 || isVideo) {
                            Text(
                                text = "12.8 MB/s · ETA 00:18",
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontSize = 9.5.sp,
                                    fontFamily = FontFamily.Monospace
                                ),
                                color = if (isZip) GoldAccent else MutedIceCyan
                            )
                        }
                    }
                }
            }

            // Cancel Action
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(CircleShape)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = rememberRipple(bounded = true, color = SoftCoral)
                    ) { onCancel() },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = null,
                    tint = TextSecondaryDark,
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}

@Composable
fun CompactHistoryItemRow(task: TransferTaskItem) {
    val isSkipped = task.status.lowercase() == "skipped"

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = Color(0x66102034),
        border = BorderStroke(1.dp, Color(0x0FFFFFFF))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f)
            ) {
                Icon(
                    imageVector = if (isSkipped) Icons.Default.SkipNext else Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = if (isSkipped) SoftViolet else DustySage,
                    modifier = Modifier.size(16.dp)
                )
                Text(
                    text = task.fileName,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 11.5.sp,
                        textDecoration = if (isSkipped) TextDecoration.LineThrough else TextDecoration.None
                    ),
                    color = if (isSkipped) TextSecondaryDark.copy(alpha = 0.7f) else TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            if (isSkipped) {
                Surface(
                    color = SoftViolet.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(4.dp),
                    border = BorderStroke(0.5.dp, SoftViolet.copy(alpha = 0.35f))
                ) {
                    Text(
                        text = stringResource(R.string.transfer_status_skipped),
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                        color = SoftViolet
                    )
                }
            } else {
                Text(
                    text = stringResource(R.string.transfer_status_done),
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.SemiBold
                    ),
                    color = DustySage
                )
            }
        }
    }
}
