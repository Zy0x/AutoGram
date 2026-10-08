package com.autogram.app.ui.drive.preview

import com.autogram.app.features.preview.PreviewKind
import com.autogram.app.features.preview.previewKind
import com.autogram.app.ui.drive.gallery.galleryItems
import com.autogram.app.ui.drive.gallery.gallerySections
import com.autogram.app.viewmodel.DriveFileItem
import com.autogram.app.viewmodel.DriveUiState

/** Match the visible gallery ordering, never jump into folders or a different scope. */
fun previewNavigationItems(state: DriveUiState, selected: DriveFileItem): List<DriveFileItem> =
    gallerySections(galleryItems(state.items, state.searchQuery, state.mediaFilter, state.activeTopicId))
        .flatMap { it.items }.filter {
            !it.isFolder && it.cloudAccountId == selected.cloudAccountId &&
                it.cloudPeerId == selected.cloudPeerId &&
                (it.id == selected.id || (previewKind(it.mimeType, it.name) != PreviewKind.UNSUPPORTED && previewKind(it.mimeType, it.name) != PreviewKind.ZIP))
        }

/** Length-prefix segments avoid collisions; message IDs alone are not globally unique. */
fun previewItemKey(item: DriveFileItem): String = listOf(item.cloudAccountId, item.cloudPeerId,
    item.cloudMessageId?.toString(), item.id).joinToString("") { value ->
    if (value == null) "-1:" else "${value.length}:$value"
}

fun scopedPreviewItems(selected: DriveFileItem, items: List<DriveFileItem>): List<DriveFileItem> {
    val scoped = items.filter { !it.isFolder && it.cloudAccountId == selected.cloudAccountId &&
        it.cloudPeerId == selected.cloudPeerId }.distinctBy(::previewItemKey)
    return if (scoped.any { previewItemKey(it) == previewItemKey(selected) }) scoped else listOf(selected) + scoped
}
