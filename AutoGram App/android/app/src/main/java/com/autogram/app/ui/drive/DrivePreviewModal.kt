package com.autogram.app.ui.drive

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Download
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.autogram.app.R
import com.autogram.app.viewmodel.DriveFileItem
import com.autogram.app.features.cloud.preview.CloudPreview

/** Verified cloud items use their native range capability; local inventory is metadata only. */
@Composable
fun DrivePreviewModal(
    item: DriveFileItem,
    allItems: List<DriveFileItem> = emptyList(),
    onDismiss: () -> Unit,
    onNavigateItem: ((DriveFileItem) -> Unit)? = null,
    onDownload: ((DriveFileItem) -> Unit)? = null
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().testTag("drive-preview")) {
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Default.Close, stringResource(R.string.native_close))
                    }
                    Column(Modifier.weight(1f).padding(8.dp)) {
                        Text(item.name, maxLines = 2, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.titleMedium)
                        Text(formatFileSize(item.size), style = MaterialTheme.typography.bodySmall)
                    }
                    if (onDownload != null) IconButton(onClick = { onDownload(item) }, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Default.Download, stringResource(R.string.preview_action_download))
                    }
                }
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    key(item.cloudAccountId, item.cloudPeerId, item.cloudMessageId, item.id) {
                        if (item.cloudAccountId != null && item.cloudPeerId != null && item.cloudMessageId != null) {
                            CloudPreview(item, Modifier.fillMaxSize())
                        } else Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(stringResource(R.string.real_preview_unavailable))
                            if (!item.thumbnailUri.isNullOrBlank()) {
                                Text(stringResource(R.string.real_thumbnail_only))
                                AsyncImage(model = item.thumbnailUri, contentDescription = item.name,
                                    contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().heightIn(max = 300.dp))
                            }
                        }
                    }
                }
                val index = allItems.indexOfFirst {
                    it.id == item.id && it.cloudAccountId == item.cloudAccountId && it.cloudPeerId == item.cloudPeerId
                }
                if (onNavigateItem != null && index >= 0) {
                    Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically) {
                        IconButton(enabled = index > 0, onClick = { onNavigateItem(allItems[index - 1]) },
                            modifier = Modifier.size(48.dp).testTag("preview-previous")) {
                            Icon(Icons.Default.ChevronLeft, stringResource(R.string.real_previous))
                        }
                        Text(stringResource(R.string.cloud_preview_counter, index + 1, allItems.size))
                        IconButton(enabled = index < allItems.lastIndex, onClick = { onNavigateItem(allItems[index + 1]) },
                            modifier = Modifier.size(48.dp).testTag("preview-next")) {
                            Icon(Icons.Default.ChevronRight, stringResource(R.string.real_next))
                        }
                    }
                }
            }
        }
    }
}
