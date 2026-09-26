package com.autogram.app.ui.transfer

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.transfer.domain.isTerminal
import com.autogram.app.ui.components.AutoGramSurface
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.*

@Composable
fun TransferScreen(viewModel: TransferViewModel, modifier: Modifier = Modifier) {
    val state by viewModel.uiState.collectAsState()
    TransferScreenContent(state, modifier, viewModel::togglePause, viewModel::loadTransfers)
}

/** No worker telemetry is inferred from filenames, fixed fractions, or UI animation. */
@Composable
fun TransferScreenContent(state: TransferUiState, modifier: Modifier = Modifier,
    onTogglePause: (TransferTaskItem) -> Unit, onRetry: () -> Unit) {
    var selectedId by remember { mutableStateOf<String?>(null) }
    val tasks = state.activeTasks + state.completedTasks
    AutoGramSurface(modifier) {
        LazyColumn(Modifier.fillMaxSize().safeDrawingPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Text(stringResource(R.string.transfer_header_title), style = MaterialTheme.typography.headlineMedium) }
            item { Text(stringResource(R.string.real_queue_scope)) }
            item {
                OutlinedButton(onClick = onRetry, enabled = !state.isLoading) {
                    Text(stringResource(R.string.drive_action_refresh))
                }
            }
            if (state.isLoading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if (state.errorCode != null) item {
                Text(stringResource(R.string.transfer_operation_failed), color = MaterialTheme.colorScheme.error)
            }
            if (!state.isLoading && tasks.isEmpty()) item { Text(stringResource(R.string.real_no_tasks)) }
            items(tasks, key = { it.id }) { task ->
                Card(onClick = { selectedId = task.id }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(task.fileName)
                        Text(stringResource(transferStatusLabel(task.status)))
                        Text(stringResource(R.string.real_transfer_bytes, formatFileSize(task.transferredBytes),
                            if (task.totalBytes > 0) formatFileSize(task.totalBytes) else stringResource(R.string.real_unknown)))
                        if (task.totalBytes > 0) LinearProgressIndicator(
                            progress = { (task.transferredBytes.toDouble() / task.totalBytes).toFloat().coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth())
                        if (!task.isTerminal()) TextButton(onClick = { onTogglePause(task) }, enabled = !state.isLoading) {
                            Text(stringResource(if (task.paused || task.status.equals("paused", true))
                                R.string.real_resume_flag else R.string.real_pause_flag))
                        }
                    }
                }
            }
        }
    }
    tasks.firstOrNull { it.id == selectedId }?.let {
        TransferDetailModal(it, { selectedId = null }, { onTogglePause(it) })
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
