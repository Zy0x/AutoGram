package com.autogram.app.ui.drive.preview

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import coil.compose.AsyncImage
import com.autogram.app.R
import com.autogram.app.features.cloud.preview.CloudPreview
import com.autogram.app.viewmodel.DriveFileItem

@Composable
fun DrivePreviewPage(item: DriveFileItem, onPagingEnabled: (Boolean) -> Unit) {
    if (item.cloudAccountId != null && item.cloudPeerId != null && item.cloudMessageId != null) {
        CloudPreview(item, Modifier.fillMaxSize(), onPagingEnabled)
    } else Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(stringResource(R.string.real_preview_unavailable))
        PreviewPageThumbnail(item)
    }
}

/** Adjacent/dragging pages never open a stream or start a decoder/player. */
@Composable
fun PreviewPageThumbnail(item: DriveFileItem) {
    val model = item.thumbnailBytes ?: item.thumbnailUri
    if (model != null) AsyncImage(model = model, contentDescription = item.name,
        contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
}
