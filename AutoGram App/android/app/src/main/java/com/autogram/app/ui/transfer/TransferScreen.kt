package com.autogram.app.ui.transfer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.*
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
        onTogglePause = { task -> viewModel.togglePause(task) }
    )
}

@Composable
fun TransferScreenContent(
    state: TransferUiState,
    modifier: Modifier = Modifier,
    onTogglePause: (TransferTaskItem) -> Unit = {}
) {
    AutoGramSurface(modifier = modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .widthIn(max = 980.dp)
                .padding(horizontal = 20.dp),
            contentPadding = PaddingValues(top = 10.dp, bottom = 100.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Clean Spacious Header
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = stringResource(R.string.transfer_title),
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = (-0.3).sp
                            ),
                            color = TextPrimaryDark
                        )
                        Text(
                            text = "Monitor antrean & transmisi MTProto",
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = TextSecondaryDark
                        )
                    }

                    if (state.isSmartRateActive) {
                        StatusPill(
                            text = stringResource(R.string.transfer_smart_rate),
                            color = DustySage,
                            isLive = true
                        )
                    }
                }
            }

            // Spacious Cyber Speedometer Hub (Stitch Soft Luxury)
            item {
                val totalSpeedBps = state.activeTasks.sumOf { it.speedBps }
                val formattedSpeed = if (totalSpeedBps > 0) formatFileSize(totalSpeedBps) + "/s" else "0.0 B/s"

                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    borderColor = ChampagneGold.copy(alpha = 0.25f),
                    containerColor = SurfaceGlassStrong
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                AutoGramStatusDot(color = ChampagneGold, isPulsing = totalSpeedBps > 0, size = 6.dp)
                                Text(
                                    text = "THROUGHPUT ENGINE",
                                    style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 1.2.sp, fontSize = 10.sp),
                                    color = ChampagneGold,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Surface(
                                color = DustySage.copy(alpha = 0.12f),
                                shape = RoundedCornerShape(6.dp)
                            ) {
                                Text(
                                    text = "MTProto 512KB",
                                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                    color = DustySage,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }

                        // Large Speed Metric
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.Bottom
                        ) {
                            Column {
                                Text(
                                    text = formattedSpeed,
                                    style = MaterialTheme.typography.headlineLarge.copy(
                                        fontSize = 34.sp,
                                        fontWeight = FontWeight.Black,
                                        letterSpacing = (-0.5).sp
                                    ),
                                    color = TextPrimaryDark
                                )
                                Text(
                                    text = "Kecepatan Transfer Real-Time",
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                    color = TextMutedDark
                                )
                            }

                            Text(
                                text = "${(state.aggregateProgress * 100).toInt()}%",
                                style = MaterialTheme.typography.headlineMedium.copy(
                                    fontSize = 22.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = ChampagneGold
                                )
                            )
                        }

                        AutoGramProgressBar(
                            progress = state.aggregateProgress,
                            brush = ChampagneToCyanBrush,
                            height = 6.dp
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "Antrean Aktif: ${state.activeTasks.size} Berkas",
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = TextSecondaryDark
                            )
                            Text(
                                text = "Selesai: ${state.completedTasks.size}",
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = DustySage
                            )
                        }
                    }
                }
            }

            // Active Tasks Header
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = stringResource(R.string.transfer_active_tasks),
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        color = TextPrimaryDark
                    )
                    if (state.activeTasks.isNotEmpty()) {
                        Surface(
                            color = ChampagneGold.copy(alpha = 0.15f),
                            shape = CircleShape
                        ) {
                            Text(
                                text = "${state.activeTasks.size}",
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                                color = ChampagneGold
                            )
                        }
                    }
                }
            }

            items(state.activeTasks, key = { it.id }) { task ->
                CyberTransferTaskCard(task = task, onTogglePause = { onTogglePause(task) })
            }

            if (!state.isLoading && state.activeTasks.isEmpty()) {
                item {
                    AutoGramEmptyState(
                        title = stringResource(R.string.transfer_empty),
                        description = "Tidak ada proses transfer yang sedang berjalan.",
                        icon = Icons.Default.Speed
                    )
                }
            }

            // Completed Tasks Header
            if (state.completedTasks.isNotEmpty()) {
                item {
                    Text(
                        text = stringResource(R.string.transfer_completed_tasks),
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        color = TextPrimaryDark,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }

                items(state.completedTasks, key = { it.id }) { task ->
                    CyberTransferTaskCard(task = task, onTogglePause = { onTogglePause(task) })
                }
            }
        }
    }
}

@Composable
fun CyberTransferTaskCard(task: TransferTaskItem, onTogglePause: () -> Unit) {
    val progress = if (task.totalBytes > 0) {
        task.transferredBytes.toFloat() / task.totalBytes.toFloat()
    } else 0f

    val stageColor = when (task.stage.lowercase()) {
        "scan" -> StageScan
        "download" -> StageDownload
        "verify" -> StageVerify
        "reencode", "encode", "convert" -> StageEncode
        "upload", "uploading" -> StageUpload
        "commit" -> StageCommit
        "reconcile" -> StageReconcile
        else -> TextSecondaryDark
    }

    AutoGramGlassCard(
        modifier = Modifier.fillMaxWidth(),
        borderColor = if (!task.paused && task.speedBps > 0) ChampagneGold.copy(alpha = 0.35f) else BorderHairline,
        containerColor = SurfaceGlass
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = task.fileName,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = TextPrimaryDark,
                        maxLines = 1
                    )
                    Spacer(Modifier.height(1.dp))
                    Text(
                        text = "${task.sourceIdentity} → ${task.destinationIdentity}",
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                        color = TextMutedDark,
                        maxLines = 1
                    )
                }

                if (task.status.lowercase() !in setOf("completed", "failed", "cancelled")) {
                    Surface(
                        onClick = onTogglePause,
                        shape = CircleShape,
                        color = if (task.paused) ChampagneGold.copy(alpha = 0.15f) else WarmAmber.copy(alpha = 0.15f),
                        border = BorderStroke(1.dp, if (task.paused) ChampagneGold.copy(alpha = 0.4f) else WarmAmber.copy(alpha = 0.4f)),
                        modifier = Modifier.size(36.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = if (task.paused) Icons.Default.PlayArrow else Icons.Default.Pause,
                                contentDescription = stringResource(
                                    if (task.paused) R.string.transfer_action_resume else R.string.transfer_action_pause
                                ),
                                tint = if (task.paused) ChampagneGold else WarmAmber,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                }
            }

            // Multi-Stage Pipeline Visual
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                val stages = listOf("Scan", "SHA256", "Re-encode", "Upload", "Reconcile")
                val currentStageIndex = when (task.stage.lowercase()) {
                    "scan" -> 0
                    "verify" -> 1
                    "reencode", "encode", "convert" -> 2
                    "upload", "uploading" -> 3
                    "commit", "reconcile" -> 4
                    else -> 3
                }

                stages.forEachIndexed { index, name ->
                    val isDone = index < currentStageIndex
                    val isCurrent = index == currentStageIndex
                    val pillBg = when {
                        isCurrent -> stageColor.copy(alpha = 0.2f)
                        isDone -> DustySage.copy(alpha = 0.12f)
                        else -> SurfaceDeep.copy(alpha = 0.5f)
                    }
                    val pillColor = when {
                        isCurrent -> stageColor
                        isDone -> DustySage
                        else -> TextMutedDark
                    }

                    Surface(
                        color = pillBg,
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(0.5.dp, if (isCurrent) stageColor.copy(alpha = 0.6f) else BorderHairline)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(3.dp)
                        ) {
                            if (isDone) {
                                Icon(Icons.Default.Check, null, tint = DustySage, modifier = Modifier.size(10.dp))
                            } else if (isCurrent) {
                                AutoGramStatusDot(color = stageColor, isPulsing = true, size = 4.dp)
                            }
                            Text(
                                text = name,
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                                color = pillColor,
                                fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }
            }

            AutoGramProgressBar(
                progress = progress,
                brush = Brush.horizontalGradient(listOf(stageColor, ChampagneGold)),
                height = 5.dp
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "${formatFileSize(task.transferredBytes)} / ${formatFileSize(task.totalBytes)}",
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                    color = TextSecondaryDark
                )

                if (task.speedBps > 0) {
                    Text(
                        text = stringResource(R.string.transfer_speed, formatFileSize(task.speedBps)),
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp),
                        color = ChampagneGold
                    )
                } else {
                    Text(
                        text = task.status,
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                        color = TextSecondaryDark
                    )
                }
            }
        }
    }
}
