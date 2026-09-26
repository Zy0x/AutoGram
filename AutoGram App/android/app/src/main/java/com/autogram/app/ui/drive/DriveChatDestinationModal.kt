package com.autogram.app.ui.drive
import androidx.compose.runtime.Composable
import com.autogram.app.features.workspace.UnavailableOperationDialog

@Composable
fun DriveChatDestinationModal(onDismiss: () -> Unit) {
    UnavailableOperationDialog(onDismiss)
}
