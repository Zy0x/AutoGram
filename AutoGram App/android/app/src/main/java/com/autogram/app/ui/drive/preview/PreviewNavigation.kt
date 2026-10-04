package com.autogram.app.ui.drive.preview

import com.autogram.app.features.preview.PreviewKind
import com.autogram.app.features.preview.previewKind
import com.autogram.app.ui.drive.gallery.galleryItems
import com.autogram.app.ui.drive.gallery.gallerySections
import com.autogram.app.viewmodel.DriveFileItem
import com.autogram.app.viewmodel.DriveUiState

/** Match the visible gallery ordering, never jump into folders or a different scope. */
fun previewNavigationItems(state: DriveUiState, selected: DriveFileItem): List<DriveFileItem> =
    gallerySections(galleryItems(state.items, state.searchQuery, state.mediaFilter))
        .flatMap { it.items }.filter {
            !it.isFolder && it.cloudAccountId == selected.cloudAccountId &&
                it.cloudPeerId == selected.cloudPeerId &&
                (it.id == selected.id || (previewKind(it.mimeType) != PreviewKind.UNSUPPORTED && previewKind(it.mimeType) != PreviewKind.ZIP))
        }
