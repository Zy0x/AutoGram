package com.autogram.app.features.localdownload

import android.text.format.Formatter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R

@Composable
internal fun LocalDownloadCard(
    item: LocalDownloadItem,
    busy: Boolean,
    onCancel: (LocalDownloadItem) -> Unit,
    onOpen: (Long) -> Unit,
    onForget: (Long) -> Unit
) {
    val context = LocalContext.current
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(item.filename, style = MaterialTheme.typography.titleSmall)
            Text(stringResource(item.status.textResource()), style = MaterialTheme.typography.bodyMedium)
            val progress = LocalDownloadPolicy.progress(
                item.downloaded, item.total, item.status == LocalDownloadStatus.COMPLETED
            )
            if (item.status.active) {
                if (progress == null) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                else LinearProgressIndicator(progress = progress, modifier = Modifier.fillMaxWidth())
            }
            Text(
                if (item.total > 0) stringResource(
                    R.string.local_download_progress_known,
                    Formatter.formatFileSize(context, item.downloaded), Formatter.formatFileSize(context, item.total)
                ) else stringResource(R.string.local_download_progress_unknown, Formatter.formatFileSize(context, item.downloaded)),
                style = MaterialTheme.typography.bodySmall
            )
            item.reason?.let { Text(stringResource(R.string.local_download_failure_code, it)) }
            if (item.status.active) {
                TextButton(onClick = { onCancel(item) }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.local_download_cancel))
                }
            } else {
                if (item.status == LocalDownloadStatus.COMPLETED) {
                    TextButton(onClick = { onOpen(item.id) }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.local_download_open))
                    }
                }
                TextButton(onClick = { onForget(item.id) }, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.local_download_forget))
                }
                Text(stringResource(R.string.local_download_forget_hint), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

internal fun LocalDownloadStatus.textResource(): Int = when (this) {
    LocalDownloadStatus.PENDING -> R.string.local_download_pending
    LocalDownloadStatus.RUNNING -> R.string.local_download_running
    LocalDownloadStatus.WAITING_NETWORK -> R.string.local_download_waiting_network
    LocalDownloadStatus.WAITING_RETRY -> R.string.local_download_waiting_retry
    LocalDownloadStatus.WAITING_SYSTEM -> R.string.local_download_waiting_system
    LocalDownloadStatus.COMPLETED -> R.string.local_download_completed
    LocalDownloadStatus.FAILED -> R.string.local_download_failed
    LocalDownloadStatus.MISSING -> R.string.local_download_missing
    LocalDownloadStatus.UNSUPPORTED -> R.string.local_download_unsupported
}

internal fun LocalDownloadError.textResource(): Int = when (this) {
    LocalDownloadError.INVALID_URL -> R.string.local_download_error_url
    LocalDownloadError.PROBE_FAILED -> R.string.local_download_error_probe
    LocalDownloadError.REDIRECT -> R.string.local_download_error_redirect
    LocalDownloadError.CONTENT_TYPE -> R.string.local_download_error_content
    LocalDownloadError.STORAGE -> R.string.local_download_error_storage
    LocalDownloadError.SERVICE -> R.string.local_download_error_service
    LocalDownloadError.START_FAILED -> R.string.local_download_error_start
    LocalDownloadError.PERSIST_FAILED -> R.string.local_download_error_persist
    LocalDownloadError.REFRESH_FAILED -> R.string.local_download_error_refresh
    LocalDownloadError.CANCEL_FAILED -> R.string.local_download_error_cancel
    LocalDownloadError.OPEN_FAILED -> R.string.local_download_error_open
    LocalDownloadError.LIMIT -> R.string.local_download_error_limit
}
