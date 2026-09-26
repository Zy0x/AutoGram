package com.autogram.app.ui.drive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import com.autogram.app.R
import com.autogram.app.viewmodel.DriveFileItem

/** Metadata/thumbnail only until a real cloud byte source is available. */
@Composable
fun DrivePreviewModal(
    item: DriveFileItem,
    allItems: List<DriveFileItem> = emptyList(),
    onDismiss: () -> Unit,
    onNavigateItem: ((DriveFileItem) -> Unit)? = null,
    onDownload: ((DriveFileItem) -> Unit)? = null
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(20.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(item.name, style = MaterialTheme.typography.titleMedium)
                Text(formatFileSize(item.size))
                Text(stringResource(R.string.real_preview_unavailable))
                if (!item.thumbnailUri.isNullOrBlank()) {
                    Text(stringResource(R.string.real_thumbnail_only))
                    AsyncImage(model = item.thumbnailUri, contentDescription = item.name,
                        contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().height(200.dp))
                }
                val index = allItems.indexOfFirst { it.id == item.id }
                if (onNavigateItem != null && index >= 0) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(enabled = index > 0, onClick = { onNavigateItem(allItems[index - 1]) }) {
                            Text(stringResource(R.string.real_previous))
                        }
                        TextButton(enabled = index < allItems.lastIndex,
                            onClick = { onNavigateItem(allItems[index + 1]) }) {
                            Text(stringResource(R.string.real_next))
                        }
                    }
                }
                if (onDownload != null) {
                    TextButton(onClick = { onDownload(item) }) { Text(stringResource(R.string.preview_action_download)) }
                }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.native_close)) }
            }
        }
    }
}
