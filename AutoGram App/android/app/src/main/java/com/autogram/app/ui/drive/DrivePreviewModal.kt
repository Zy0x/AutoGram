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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.autogram.app.R
import com.autogram.app.viewmodel.DriveFileItem
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import com.autogram.app.ui.drive.preview.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.input.key.*
import androidx.compose.foundation.focusable
import com.autogram.app.features.preview.PreviewKind
import com.autogram.app.features.preview.previewKind
import com.autogram.app.features.cloud.preview.controls.*

/** Verified cloud items use their native range capability; local inventory is metadata only. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun DrivePreviewModal(
    item: DriveFileItem,
    allItems: List<DriveFileItem> = emptyList(),
    onDismiss: () -> Unit,
    onNavigateItem: ((DriveFileItem) -> Unit)? = null,
    onDownload: ((DriveFileItem) -> Unit)? = null,
    previewContent: @Composable (DriveFileItem, (Boolean) -> Unit) -> Unit = { record, paging -> DrivePreviewPage(record, paging) }
) {
    var showInfoSheet by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var toolGroup by remember { mutableStateOf<String?>(null) }
    val tools = remember { PreviewToolsRegistry() }
    val coroutineScope = rememberCoroutineScope()
    val entries = scopedPreviewItems(item, allItems)
    val keys = entries.map(::previewItemKey)
    val requestedKey = previewItemKey(item)
    val initialIndex = keys.indexOf(requestedKey).coerceAtLeast(0)
    val pagerState = rememberPagerState(
        initialPage = initialIndex,
        pageCount = { entries.size }
    )
    var pagingEnabled by remember { mutableStateOf(true) }
    var activeKey by remember { mutableStateOf(requestedKey) }
    var lastRequest by remember { mutableStateOf(requestedKey) }
    var lastKeys by remember { mutableStateOf(keys) }
    var aligning by remember { mutableStateOf(false) }
    val activeItem = entries.firstOrNull { previewItemKey(it) == activeKey } ?: item
    // Selection/reorder alignment must not be cancelled by its own pager changes.
    // Otherwise an old settled index can select a different record after a reorder.
    LaunchedEffect(requestedKey, keys) {
        var needsAlignment = lastKeys != keys
        if (lastRequest != requestedKey) {
            lastRequest = requestedKey
            if (requestedKey != activeKey) {
                activeKey = requestedKey; pagingEnabled = true
                needsAlignment = true
            }
        }
        if (needsAlignment) {
            aligning = true
            val index = keys.indexOf(activeKey)
            val target = index.coerceAtLeast(0)
            try {
                // Let the pager apply new keys/count before resolving its new index.
                withFrameNanos { }
                pagerState.scrollToPage(target)
                snapshotFlow { !pagerState.isScrollInProgress && pagerState.settledPage == target && pagerState.currentPage == target }
                    .first { it }
                lastKeys = keys
            }
            finally { aligning = false }
        }
    }
    LaunchedEffect(keys, pagerState.settledPage, pagerState.isScrollInProgress, aligning) {
        if (!aligning && lastKeys == keys && lastRequest == requestedKey && !pagerState.isScrollInProgress) {
            entries.getOrNull(pagerState.settledPage)?.let { current ->
                if (previewItemKey(current) != activeKey) {
                    activeKey = previewItemKey(current); pagingEnabled = true
                    menuOpen = false; showInfoSheet = false
                    onNavigateItem?.invoke(current)
                }
            }
        }
    }
    val previousLabel = stringResource(R.string.real_previous)
    val nextLabel = stringResource(R.string.real_next)
    val navigationReady = !tools.navigationLocked && !aligning && lastKeys == keys && lastRequest == requestedKey && !pagerState.isScrollInProgress
    LaunchedEffect(activeKey) { toolGroup = null; menuOpen = false }
    fun navigate(delta: Int): Boolean {
        val target = pagerState.settledPage + delta
        if (!navigationReady || target !in entries.indices) return false
        coroutineScope.launch { pagerState.animateScrollToPage(target) }
        return true
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
      CompositionLocalProvider(LocalPreviewTools provides tools, LocalPreviewNavigation provides ::navigate) {
        Surface(Modifier.fillMaxSize().testTag("drive-preview")
            .semantics { customActions = buildList {
                if (navigationReady && pagerState.settledPage > 0) add(CustomAccessibilityAction(previousLabel) { navigate(-1) })
                if (navigationReady && pagerState.settledPage < entries.lastIndex) add(CustomAccessibilityAction(nextLabel) { navigate(1) })
            } }
            .onPreviewKeyEvent {
                if (it.type != KeyEventType.KeyUp) false
                else if (it.key == Key.Escape) { onDismiss(); true }
                else if (previewKind(activeItem.mimeType, activeItem.name) == PreviewKind.IMAGE) when (it.key) {
                    Key.DirectionLeft -> navigate(-1)
                    Key.DirectionRight -> navigate(1)
                    else -> false
                } else false
            }.focusable()) {
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
                            PreviewToolMenuItems(tools.tools, { menuOpen = false }, { toolGroup = it })
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
                        HorizontalPager(
                            state = pagerState,
                            userScrollEnabled = pagingEnabled && !tools.navigationLocked &&
                                previewKind(activeItem.mimeType, activeItem.name) != PreviewKind.VIDEO &&
                                !aligning && lastKeys == keys && lastRequest == requestedKey,
                            modifier = Modifier.fillMaxSize().testTag("preview-pager"),
                            key = { page -> keys[page] }
                        ) { page ->
                            val pageItem = entries[page]
                            key(pageItem.cloudAccountId, pageItem.cloudPeerId, pageItem.cloudMessageId, pageItem.id) {
                                if (page == pagerState.settledPage && !pagerState.isScrollInProgress &&
                                    !aligning && lastKeys == keys && lastRequest == requestedKey &&
                                    previewItemKey(pageItem) == activeKey) {
                                    previewContent(pageItem) { pagingEnabled = it }
                                } else {
                                    PreviewPageThumbnail(pageItem)
                                }
                            }
                        }
                }
                if (entries.size > 1) {
                    Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically) {
                        IconButton(enabled = pagerState.settledPage > 0 && navigationReady, onClick = { navigate(-1) },
                            modifier = Modifier.size(48.dp).testTag("preview-previous")) {
                            Icon(Icons.Default.ChevronLeft, stringResource(R.string.real_previous))
                        }
                        Text(stringResource(R.string.cloud_preview_counter, pagerState.settledPage + 1, entries.size), Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                        IconButton(enabled = pagerState.settledPage < entries.lastIndex && navigationReady, onClick = { navigate(1) },
                            modifier = Modifier.size(48.dp).testTag("preview-next")) {
                            Icon(Icons.Default.ChevronRight, stringResource(R.string.real_next))
                        }
                    }
                }
            }
        }
        tools.tools.firstOrNull { it.id == toolGroup }?.let { PreviewToolDialog(it) { toolGroup = null } }
      }
    }

    if (showInfoSheet) {
        DriveFileInfoSheet(
            item = activeItem,
            onDismiss = { showInfoSheet = false }
        )
    }
}
