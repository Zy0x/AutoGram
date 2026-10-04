package com.autogram.app.ui.transfer

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.autogram.app.R
import com.autogram.app.transfer.domain.isTerminal
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.TransferTaskItem

@Composable
fun TransferDetailModal(task: TransferTaskItem, onDismiss: () -> Unit, onTogglePause: () -> Unit) {
    var showDiagnostics by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }

    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(task.fileName, style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.real_queue_scope))
                Text(stringResource(transferStatusLabel(task.status)))
                Text(stringResource(R.string.real_transfer_speed, formatFileSize(task.speedBps)))
                Text(stringResource(R.string.real_transfer_attempt, task.attempt))
                if (!task.isTerminal()) TextButton(onClick = onTogglePause) {
                    Text(stringResource(if (task.paused || task.status.equals("paused", true))
                        R.string.real_resume_flag else R.string.real_pause_flag))
                }
                TextButton(onClick = { showDiagnostics = true }) {
                    Text(stringResource(R.string.diagnostic_action_view))
                }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.native_close)) }
            }
        }
    }

    if (showDiagnostics) {
        TransferDiagnosticModal(task = task, onDismiss = { showDiagnostics = false })
    }
}
