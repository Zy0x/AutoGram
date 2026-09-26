package com.autogram.app.ui.transfer
import androidx.compose.runtime.Composable
import com.autogram.app.features.workspace.UnavailableOperationDialog

@Composable
fun TransferCaptionModal(onDismiss: () -> Unit) {
    UnavailableOperationDialog(onDismiss)
}
