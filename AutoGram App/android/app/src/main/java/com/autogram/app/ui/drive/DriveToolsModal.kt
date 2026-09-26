package com.autogram.app.ui.drive
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.autogram.app.R
import com.autogram.app.viewmodel.DriveFileItem

@Composable
fun DriveToolsModal(allItems: List<DriveFileItem>, onDismiss: () -> Unit) {
    val files = allItems.filterNot { it.isFolder }
    val bytes = files.fold(0L) { total, item -> total + item.size.coerceIn(0, Long.MAX_VALUE - total) }
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.tools_title), style = MaterialTheme.typography.titleLarge)
                Text(stringResource(R.string.real_cache_scope))
                Text(stringResource(R.string.real_cache_count, files.size, allItems.count { it.isFolder }))
                Text(stringResource(R.string.real_cache_bytes, formatFileSize(bytes)))
                files.sortedByDescending { it.size }.take(5).forEach {
                    Text(it.name)
                    Text(formatFileSize(it.size))
                }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.native_close)) }
            }
        }
    }
}
