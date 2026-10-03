package com.autogram.app.ui.transfer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.transfer.domain.isTerminal
import com.autogram.app.ui.components.*
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.*

private enum class TransferTab { ALL, ACTIVE, COMPLETED }

@Composable
fun TransferScreen(viewModel: TransferViewModel, modifier: Modifier = Modifier) {
    val state by viewModel.uiState.collectAsState()
    TransferScreenContent(state, modifier, viewModel::togglePause, viewModel::loadTransfers)
}

@Composable
fun TransferScreenContent(
    state: TransferUiState,
    modifier: Modifier = Modifier,
    onTogglePause: (TransferTaskItem) -> Unit,
    onRetry: () -> Unit
) {
    var selectedId by remember { mutableStateOf<String?>(null) }
    var currentTab by remember { mutableStateOf(TransferTab.ALL) }

    val allTasks = remember(state.activeTasks, state.completedTasks) {
        state.activeTasks + state.completedTasks
    }

    val displayTasks = remember(allTasks, currentTab) {
        when (currentTab) {
            TransferTab.ALL -> allTasks
            TransferTab.ACTIVE -> allTasks.filter { !it.isTerminal() }
            TransferTab.COMPLETED -> allTasks.filter { it.isTerminal() }
        }
    }

    AutoGramSurface(modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header: Title & Refresh Button
            item(key = "header") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.transfer_header_title),
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 24.sp,
                                letterSpacing = (-0.5).sp
                            ),
                            color = TextPrimaryDark
                        )
                        Text(
                            text = stringResource(R.string.ui2_transfer_subtitle),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                            color = TextSecondaryDark
                        )
                    }

                    IconButton(
                        onClick = onRetry,
                        enabled = !state.isLoading,
                        modifier = Modifier.size(44.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = stringResource(R.string.drive_action_refresh),
                            tint = if (!state.isLoading) MutedIceCyan else TextSecondaryDark
                        )
                    }
                }
            }

            // Segmented Filter Tabs: Semua / Berjalan / Selesai
            item(key = "tabs") {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    item {
                        TransferFilterChip(
                            label = stringResource(R.string.ui2_transfer_all),
                            count = allTasks.size,
                            isSelected = currentTab == TransferTab.ALL,
                            onClick = { currentTab = TransferTab.ALL }
                        )
                    }
                    item {
                        TransferFilterChip(
                            label = stringResource(R.string.ui2_transfer_active),
                            count = state.activeTasks.size,
                            isSelected = currentTab == TransferTab.ACTIVE,
                            onClick = { currentTab = TransferTab.ACTIVE }
                        )
                    }
                    item {
                        TransferFilterChip(
                            label = stringResource(R.string.ui2_transfer_completed),
                            count = state.completedTasks.size,
                            isSelected = currentTab == TransferTab.COMPLETED,
                            onClick = { currentTab = TransferTab.COMPLETED }
                        )
                    }
                }
            }

            // Loading / Error
            if (state.isLoading) {
                item(key = "loading") {
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth(),
                        color = MutedIceCyan
                    )
                }
            }

            state.errorCode?.let {
                item(key = "error") {
                    AutoGramErrorState(
                        message = stringResource(R.string.transfer_operation_failed),
                        onRetry = onRetry
                    )
                }
            }

            // Empty State
            if (!state.isLoading && displayTasks.isEmpty()) {
                item(key = "empty") {
                    AutoGramEmptyState(
                        title = stringResource(R.string.ui2_transfer_empty_title),
                        description = stringResource(R.string.ui2_transfer_empty_hint),
                        icon = Icons.Default.SwapVert,
                        modifier = Modifier.padding(top = 24.dp)
                    )
                }
            }

            // Task Items
            items(displayTasks, key = { it.id }) { task ->
                val isCompleted = task.status.equals("completed", true)
                val isRunning = task.status.equals("running", true)
                val isPaused = task.paused || task.status.equals("paused", true)
                val progressFraction = if (task.totalBytes > 0) {
                    (task.transferredBytes.toDouble() / task.totalBytes).toFloat().coerceIn(0f, 1f)
                } else 0f

                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    borderColor = if (isRunning) ChampagneGold.copy(alpha = 0.4f) else BorderHairline,
                    containerColor = SurfaceDeep,
                    onClick = { selectedId = task.id }
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        // Category Icon Badge
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = when {
                                isCompleted -> SuccessGreen.copy(alpha = 0.15f)
                                isRunning -> ChampagneGold.copy(alpha = 0.15f)
                                else -> MutedIceCyan.copy(alpha = 0.12f)
                            },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = getTaskIcon(task.fileName),
                                    contentDescription = null,
                                    tint = when {
                                        isCompleted -> SuccessGreen
                                        isRunning -> ChampagneGold
                                        else -> MutedIceCyan
                                    },
                                    modifier = Modifier.size(22.dp)
                                )
                            }
                        }

                        // Content (Filename, Status, Bytes, Progress)
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                text = task.fileName,
                                style = MaterialTheme.typography.titleSmall.copy(
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.5.sp
                                ),
                                color = TextPrimaryDark,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )

                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(
                                    text = stringResource(transferStatusLabel(task.status)),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Medium
                                    ),
                                    color = when {
                                        isCompleted -> SuccessGreen
                                        isRunning -> ChampagneGold
                                        isPaused -> WarmAmber
                                        else -> TextSecondaryDark
                                    }
                                )
                                Text(
                                    text = "•",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TextMutedDark
                                )
                                Text(
                                    text = stringResource(
                                        R.string.real_transfer_bytes,
                                        formatFileSize(task.transferredBytes),
                                        if (task.totalBytes > 0) formatFileSize(task.totalBytes) else stringResource(R.string.real_unknown)
                                    ),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                    color = TextSecondaryDark
                                )
                            }

                            if (!isCompleted && task.totalBytes > 0) {
                                Spacer(Modifier.height(2.dp))
                                AutoGramProgressBar(
                                    progress = progressFraction,
                                    height = 4.dp
                                )
                            }
                        }

                        // Right Action: Pause/Resume (48dp target) or Completed Icon
                        if (!task.isTerminal()) {
                            IconButton(
                                onClick = { onTogglePause(task) },
                                enabled = !state.isLoading,
                                modifier = Modifier.size(48.dp)
                            ) {
                                Surface(
                                    shape = CircleShape,
                                    color = if (isPaused) GoldAccent.copy(alpha = 0.15f) else SurfaceGlassSoft,
                                    border = BorderStroke(1.dp, BorderHairline),
                                    modifier = Modifier.size(36.dp)
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(
                                            imageVector = if (isPaused) Icons.Default.PlayArrow else Icons.Default.Pause,
                                            contentDescription = stringResource(
                                                if (isPaused) R.string.real_resume_flag else R.string.real_pause_flag
                                            ),
                                            tint = if (isPaused) GoldAccent else TextPrimaryDark,
                                            modifier = Modifier.size(18.dp)
                                        )
                                    }
                                }
                            }
                        } else if (isCompleted) {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = null,
                                tint = SuccessGreen,
                                modifier = Modifier.size(24.dp)
                            )
                        }
                    }
                }
            }
        }
    }

    allTasks.firstOrNull { it.id == selectedId }?.let {
        TransferDetailModal(it, { selectedId = null }, { onTogglePause(it) })
    }
}

@Composable
private fun TransferFilterChip(
    label: String,
    count: Int,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = if (isSelected) MutedIceCyan.copy(alpha = 0.2f) else SurfaceGlass,
        border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
        modifier = Modifier.heightIn(min = 36.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium.copy(
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                    fontSize = 12.sp
                ),
                color = if (isSelected) TextPrimaryDark else TextSecondaryDark
            )
            if (count > 0) {
                Surface(
                    shape = CircleShape,
                    color = if (isSelected) MutedIceCyan.copy(alpha = 0.3f) else SurfaceGlassSoft
                ) {
                    Text(
                        text = "$count",
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp, fontWeight = FontWeight.Bold),
                        color = if (isSelected) TextPrimaryDark else TextSecondaryDark,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp)
                    )
                }
            }
        }
    }
}

private fun getTaskIcon(fileName: String): ImageVector {
    val ext = fileName.substringAfterLast('.', "").lowercase()
    return when (ext) {
        "mp4", "mkv", "webm", "avi", "mov" -> Icons.Default.Movie
        "jpg", "jpeg", "png", "webp", "gif" -> Icons.Default.Image
        "mp3", "flac", "ogg", "wav", "m4a" -> Icons.Default.AudioFile
        "zip", "rar", "7z", "tar", "gz" -> Icons.Default.FolderZip
        "pdf", "doc", "docx", "txt" -> Icons.Default.Description
        else -> Icons.Default.InsertDriveFile
    }
}

internal fun transferStatusLabel(status: String): Int = when (status.lowercase()) {
    "queued" -> R.string.real_status_queued
    "running" -> R.string.real_status_running
    "paused" -> R.string.real_status_paused
    "completed" -> R.string.real_status_completed
    "failed" -> R.string.real_status_failed
    "cancelled", "canceled" -> R.string.real_status_cancelled
    "skipped" -> R.string.real_status_skipped
    else -> R.string.real_unknown
}
