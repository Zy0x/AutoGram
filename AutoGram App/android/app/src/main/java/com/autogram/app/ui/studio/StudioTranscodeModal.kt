package com.autogram.app.ui.studio
import androidx.compose.runtime.Composable
import com.autogram.app.R
import com.autogram.app.features.workspace.UnavailableOperationDialog

@Composable
fun StudioTranscodeModal(onDismiss: () -> Unit) {
    UnavailableOperationDialog(onDismiss, R.string.real_studio_scope)
}
