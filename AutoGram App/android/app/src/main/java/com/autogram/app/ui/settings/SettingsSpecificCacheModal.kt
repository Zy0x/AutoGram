package com.autogram.app.ui.settings
import androidx.compose.runtime.Composable
import com.autogram.app.R
import com.autogram.app.features.workspace.UnavailableOperationDialog

@Composable
fun SettingsSpecificCacheModal(onDismiss: () -> Unit) {
    UnavailableOperationDialog(onDismiss, R.string.real_settings_scope)
}
