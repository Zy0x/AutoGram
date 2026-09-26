package com.autogram.app.ui.drive
import androidx.compose.runtime.Composable
import com.autogram.app.R
import com.autogram.app.features.workspace.UnavailableOperationDialog
import com.autogram.app.viewmodel.DriveFileItem

/** No cloud range-reader is exposed on Android yet. Never synthesize archive entries. */
@Composable
fun ZipExplorerModal(archiveItem: DriveFileItem, onDismiss: () -> Unit) {
    UnavailableOperationDialog(onDismiss, R.string.real_preview_unavailable)
}
