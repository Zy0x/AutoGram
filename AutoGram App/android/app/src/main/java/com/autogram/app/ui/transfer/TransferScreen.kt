package com.autogram.app.ui.transfer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.TransferTaskItem
import com.autogram.app.viewmodel.TransferViewModel

@Composable
fun TransferScreen(
    viewModel: TransferViewModel,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = stringResource(R.string.transfer_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = TextPrimaryDark
                )

                if (state.isSmartRateActive) {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = SurfaceElevatedDark,
                        border = androidx.compose.foundation.BorderStroke(1.dp, PrimaryBlue)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Bolt,
                                contentDescription = stringResource(R.string.transfer_smart_rate_accessibility),
                                tint = PrimaryBlue,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                text = stringResource(R.string.transfer_smart_rate),
                                style = MaterialTheme.typography.labelSmall,
                                color = PrimaryBlue
                            )
                        }
                    }
                }
            }
        }

        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = stringResource(R.string.transfer_aggregate_progress),
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(
                            R.string.transfer_progress_percent,
                            (state.aggregateProgress * 100).toInt()
                        ),
                        style = MaterialTheme.typography.titleMedium,
                        color = PrimaryBlue
                    )
                }
                LinearProgressIndicator(
                    progress = { state.aggregateProgress },
                    modifier = Modifier.fillMaxWidth().height(8.dp),
                    color = PrimaryBlue,
                    trackColor = SurfaceElevatedDark
                )
            }
        }

        item {
            Text(
                text = stringResource(R.string.transfer_active_tasks),
                style = MaterialTheme.typography.titleLarge,
                color = TextPrimaryDark,
                modifier = Modifier.padding(top = 8.dp)
            )
        }

        items(state.activeTasks, key = { it.id }) { task ->
            TransferTaskCard(task = task, onTogglePause = { viewModel.togglePause(task) })
        }

        if (state.completedTasks.isNotEmpty()) {
            item {
                Text(
                    text = stringResource(R.string.transfer_completed_tasks),
                    style = MaterialTheme.typography.titleLarge,
                    color = TextPrimaryDark,
                    modifier = Modifier.padding(top = 16.dp)
                )
            }

            items(state.completedTasks, key = { it.id }) { task ->
                TransferTaskCard(task = task, onTogglePause = { viewModel.togglePause(task) })
            }
        }
    }
}

@Composable
fun TransferTaskCard(task: TransferTaskItem, onTogglePause: () -> Unit) {
    val progress = if (task.totalBytes > 0) {
        task.transferredBytes.toFloat() / task.totalBytes.toFloat()
    } else 0f

    val stageColor = when (task.stage.lowercase()) {
        "scan" -> StageScan
        "download" -> StageDownload
        "verify" -> StageVerify
        "reencode", "encode", "convert" -> StageEncode
        "upload" -> StageUpload
        "commit" -> StageCommit
        "reconcile" -> StageReconcile
        else -> TextSecondaryDark
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceDark),
        border = androidx.compose.foundation.BorderStroke(1.dp, BorderDark)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = task.fileName,
                        style = MaterialTheme.typography.titleMedium,
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.transfer_stage_value, task.stage),
                        style = MaterialTheme.typography.labelMedium,
                        color = stageColor
                    )
                }
                if (task.status.lowercase() !in setOf("completed", "failed", "cancelled")) {
                    FilledTonalIconButton(onClick = onTogglePause) {
                        Icon(
                            imageVector = if (task.paused) Icons.Default.PlayArrow else Icons.Default.Pause,
                            contentDescription = stringResource(
                                if (task.paused) R.string.transfer_action_resume else R.string.transfer_action_pause
                            )
                        )
                    }
                }
            }

            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp),
                color = stageColor,
                trackColor = SurfaceElevatedDark
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "${formatFileSize(task.transferredBytes)} / ${formatFileSize(task.totalBytes)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondaryDark
                )

                if (task.speedBps > 0) {
                    Text(
                        text = stringResource(R.string.transfer_speed, formatFileSize(task.speedBps)),
                        style = MaterialTheme.typography.bodyMedium,
                        color = SuccessGreen
                    )
                } else {
                    Text(
                        text = task.status,
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondaryDark
                    )
                }
            }
        }
    }
}
