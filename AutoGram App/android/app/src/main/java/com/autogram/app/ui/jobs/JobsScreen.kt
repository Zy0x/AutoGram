package com.autogram.app.ui.jobs

import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.features.cloudtransfer.DownloadPanel
import com.autogram.app.features.cloudtransfer.services.DownloadQueue
import com.autogram.app.features.cloudtransfer.services.NativeDownloadQueue
import com.autogram.app.features.workspace.execution.ExecutionBoundaryScreen
import com.autogram.app.features.workspace.execution.PendingExecutionDomain

@Composable
fun JobsScreen(modifier: Modifier = Modifier, accountId: String = "", queue: DownloadQueue = NativeDownloadQueue) {
    var downloadsOpen by remember(accountId) { mutableStateOf(false) }
    JobsScreenContent(accountId.isNotBlank(), { downloadsOpen = true }, modifier)
    // Opening this page never enqueues or wakes work. Native queue actions remain explicit.
    // Keep SAF and account lifetime outside scrolling content, as on Drive/Transfers.
    DownloadPanel(accountId, null, {}, queue = queue, showLauncher = false, openRequested = downloadsOpen,
        onOpenRequestConsumed = { downloadsOpen = false })
}

@Composable
fun JobsScreenContent(accountAvailable: Boolean, onOpenDownloads: () -> Unit, modifier: Modifier = Modifier) {
    ExecutionBoundaryScreen(PendingExecutionDomain.JOBS, modifier) {
        Text(stringResource(R.string.execution_available_downloads))
        OutlinedButton(onClick = onOpenDownloads, enabled = accountAvailable,
            modifier = Modifier.heightIn(min = 48.dp).testTag("jobs-native-downloads")) {
            Text(stringResource(R.string.cloud_download_title))
        }
        if (!accountAvailable) Text(stringResource(R.string.execution_account_required))
    }
}
