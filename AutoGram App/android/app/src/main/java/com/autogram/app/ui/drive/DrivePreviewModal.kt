package com.autogram.app.ui.drive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
import kotlinx.coroutines.launch

/** Verified cloud items use their native range capability; local inventory is metadata only. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun DrivePreviewModal(
    item: DriveFileItem,
    allItems: List<DriveFileItem> = emptyList(),
    onDismiss: () -> Unit,
    onNavigateItem: ((DriveFileItem) -> Unit)? = null,
    onDownload: ((DriveFileItem) -> Unit)? = null
) {
    var showInfoSheet by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    val coroutineScope = rememberCoroutineScope()
    val initialIndex = remember(item, allItems) {
        allItems.indexOfFirst {
            it.id == item.id && it.cloudAccountId == item.cloudAccountId && it.cloudPeerId == item.cloudPeerId
        }.coerceAtLeast(0)
    }
    val pagerState = rememberPagerState(
        initialPage = initialIndex,
        pageCount = { if (allItems.isNotEmpty()) allItems.size else 1 }
    )
    val activeItem = if (allItems.isNotEmpty()) allItems.getOrNull(pagerState.currentPage) ?: item else item

    LaunchedEffect(pagerState.currentPage) {
        val current = allItems.getOrNull(pagerState.currentPage)
        if (current != null && current.id != item.id) {
            onNavigateItem?.invoke(current)
        }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().testTag("drive-preview")) {
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Default.Close, stringResource(R.string.native_close))
                    }
                    Column(Modifier.weight(1f).padding(8.dp)) {
                        Text(activeItem.name, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.titleMedium)
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(48.dp)) {
                            Icon(Icons.Default.MoreVert, stringResource(R.string.clean_gallery_actions))
                        }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.file_info_title)) },
                                leadingIcon = { Icon(Icons.Default.Info, null) },
                                onClick = { menuOpen = false; showInfoSheet = true })
                            if (onDownload != null) DropdownMenuItem(
                                text = { Text(stringResource(R.string.preview_action_download)) },
                                leadingIcon = { Icon(Icons.Default.Download, null) },
                                onClick = { menuOpen = false; onDownload(activeItem) })
                        }
                    }
                }
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    if (allItems.isNotEmpty()) {
                        HorizontalPager(
                            state = pagerState,
                            modifier = Modifier.fillMaxSize().testTag("preview-pager"),
                            key = { page -> allItems[page].id }
                        ) { page ->
                            val pageItem = allItems[page]
                            key(pageItem.cloudAccountId, pageItem.cloudPeerId, pageItem.cloudMessageId, pageItem.id) {
                                if (pageItem.cloudAccountId != null && pageItem.cloudPeerId != null && pageItem.cloudMessageId != null) {
                                    CloudPreview(pageItem, Modifier.fillMaxSize())
                                } else Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(stringResource(R.string.real_preview_unavailable))
                                    if (!pageItem.thumbnailUri.isNullOrBlank()) {
                                        Text(stringResource(R.string.real_thumbnail_only))
                                        AsyncImage(
                                            model = pageItem.thumbnailUri,
                                            contentDescription = pageItem.name,
                                            contentScale = ContentScale.Fit,
                                            modifier = Modifier.fillMaxWidth().heightIn(max = 300.dp)
                                        )
                                    }
                                }
                            }
                        }
                    } else {
                        key(item.cloudAccountId, item.cloudPeerId, item.cloudMessageId, item.id) {
                            if (item.cloudAccountId != null && item.cloudPeerId != null && item.cloudMessageId != null) {
                                CloudPreview(item, Modifier.fillMaxSize())
                            } else Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(stringResource(R.string.real_preview_unavailable))
                                if (!item.thumbnailUri.isNullOrBlank()) {
                                    Text(stringResource(R.string.real_thumbnail_only))
                                    AsyncImage(
                                        model = item.thumbnailUri,
                                        contentDescription = item.name,
                                        contentScale = ContentScale.Fit,
                                        modifier = Modifier.fillMaxWidth().heightIn(max = 300.dp)
                                    )
                                }
                            }
                        }
                    }
                }
                if (allItems.size > 1) {
                    Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically) {
                        IconButton(enabled = pagerState.currentPage > 0, onClick = {
                            coroutineScope.launch { pagerState.animateScrollToPage(pagerState.currentPage - 1) }
                        },
                            modifier = Modifier.size(48.dp).testTag("preview-previous")) {
                            Icon(Icons.Default.ChevronLeft, stringResource(R.string.real_previous))
                        }
                        Text(stringResource(R.string.cloud_preview_counter, pagerState.currentPage + 1, allItems.size))
                        IconButton(enabled = pagerState.currentPage < allItems.lastIndex, onClick = {
                            coroutineScope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
                        },
                            modifier = Modifier.size(48.dp).testTag("preview-next")) {
                            Icon(Icons.Default.ChevronRight, stringResource(R.string.real_next))
                        }
                    }
                }
            }
        }
    }

    if (showInfoSheet) {
        DriveFileInfoSheet(
            item = activeItem,
            onDismiss = { showInfoSheet = false }
        )
    }
}
