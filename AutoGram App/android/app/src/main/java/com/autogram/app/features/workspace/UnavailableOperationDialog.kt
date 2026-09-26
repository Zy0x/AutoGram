package com.autogram.app.features.workspace

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.autogram.app.R

/** No success feedback, credential intake, or mutation without a working executor. */
@Composable
fun UnavailableOperationDialog(onDismiss: () -> Unit, reason: Int = R.string.real_cloud_unavailable) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.capability_unavailable)) },
        text = { Text(stringResource(reason)) },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.native_close)) } }
    )
}
