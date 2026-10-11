package com.autogram.app.features.cloudtransfer.upload

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import uniffi.autogram_android_bridge.NativeCloudUpload

@Composable
internal fun UploadRow(record: NativeCloudUpload, onControl: (String) -> Unit, onReconcile: () -> Unit) {
    val label = when (record.state) {
        "queued" -> R.string.cloud_download_queued
        "running" -> R.string.cloud_upload_running
        "paused" -> R.string.cloud_download_paused
        "retry_wait" -> R.string.cloud_upload_waiting
        "committing" -> R.string.cloud_upload_verifying
        "review_required" -> R.string.cloud_upload_review
        "completed" -> R.string.cloud_upload_completed
        "cancelled" -> R.string.cloud_download_cancelled
        else -> R.string.cloud_download_failed
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(record.filename)
        Text(stringResource(label))
        Text(stringResource(R.string.cloud_download_bytes, record.uploadedBytes.toString(), record.size.toString()))
        if (record.state == "running" && record.size > 0uL) LinearProgressIndicator(
            progress = { (record.uploadedBytes.toDouble() / record.size.toDouble()).toFloat().coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (record.state in listOf("queued", "running", "retry_wait")) TextButton(onClick = { onControl("pause") }) {
                Text(stringResource(R.string.cloud_download_pause))
            }
            if (record.state in listOf("paused", "failed")) TextButton(onClick = { onControl("retry") },
                enabled = record.retryNotBeforeMs?.let { it <= System.currentTimeMillis() } != false) {
                Text(stringResource(R.string.cloud_download_resume))
            }
            if (record.state in listOf("queued", "running", "paused", "failed", "retry_wait")) TextButton(onClick = { onControl("cancel") }) {
                Text(stringResource(R.string.drive_action_cancel))
            }
            if (record.state == "review_required") TextButton(onClick = onReconcile) {
                Text(stringResource(R.string.cloud_upload_check_receipt))
            }
        }
        HorizontalDivider()
    }
}
