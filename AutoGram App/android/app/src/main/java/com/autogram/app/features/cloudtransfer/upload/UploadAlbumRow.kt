package com.autogram.app.features.cloudtransfer.upload

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import uniffi.autogram_android_bridge.NativeCloudAlbum

@Composable
internal fun UploadAlbumRow(record: NativeCloudAlbum, onControl: (String) -> Unit, onReconcile: () -> Unit) {
    val stateLabel = when (record.state) {
        "queued" -> R.string.cloud_upload_album_queued
        "preparing" -> R.string.cloud_upload_album_preparing
        "committing" -> R.string.cloud_upload_verifying
        "paused" -> R.string.cloud_download_paused
        "review_required" -> R.string.cloud_upload_review
        "completed" -> R.string.cloud_upload_album_completed
        "cancelled" -> R.string.cloud_download_cancelled
        else -> R.string.cloud_download_failed
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(stringResource(R.string.cloud_upload_album_row_title, record.itemCount.toInt()))
        Text(stringResource(stateLabel))
        Text(stringResource(R.string.cloud_download_bytes, record.uploadedBytes.toString(), record.totalBytes.toString()))
        if (record.state == "preparing" && record.totalBytes > 0uL) LinearProgressIndicator(
            progress = { (record.uploadedBytes.toDouble() / record.totalBytes.toDouble()).toFloat().coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (record.state in listOf("queued", "preparing")) TextButton(onClick = { onControl("pause") }) {
                Text(stringResource(R.string.cloud_download_pause))
            }
            if (record.state == "paused") TextButton(onClick = { onControl("resume") }) {
                Text(stringResource(R.string.cloud_download_resume))
            }
            if (record.state in listOf("queued", "preparing", "paused")) TextButton(onClick = { onControl("cancel") }) {
                Text(stringResource(R.string.drive_action_cancel))
            }
            if (record.state == "review_required") TextButton(onClick = onReconcile) {
                Text(stringResource(R.string.cloud_upload_check_receipt))
            }
        }
        HorizontalDivider()
    }
}
