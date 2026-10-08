package com.autogram.app.features.cloud.preview

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.features.cloud.preview.image.*

/** Pinch/pan and double-tap only the decoded image, never its navigation chrome. */
@Composable
internal fun CloudImageViewer(bitmap: Bitmap, name: String, onPagingEnabled: (Boolean) -> Unit = {}) {
    var transform by remember(bitmap) { mutableStateOf(ImageTransform()) }
    val pagingCallback by rememberUpdatedState(onPagingEnabled)
    DisposableEffect(bitmap) { onDispose { pagingCallback(true) } }
    BoxWithConstraints(Modifier.fillMaxSize().clipToBounds()) {
        val density = LocalDensity.current
        val width = with(density) { maxWidth.toPx() }
        val height = with(density) { maxHeight.toPx() }
        val fit = minOf(width / bitmap.width, height / bitmap.height)
        val imageWidth = bitmap.width * fit
        val imageHeight = bitmap.height * fit
        fun update(next: ImageTransform) {
            transform = next.bounded(imageWidth, imageHeight, width, height)
            pagingCallback(transform.allowsPaging)
        }
        val zoomIn = stringResource(R.string.preview_image_zoom_in)
        val zoomOut = stringResource(R.string.preview_image_zoom_out)
        val rotateLeft = stringResource(R.string.preview_rotate_ccw)
        val rotateRight = stringResource(R.string.preview_rotate_cw)
        val flipH = stringResource(R.string.preview_flip_h)
        val flipV = stringResource(R.string.preview_flip_v)
        val reset = stringResource(R.string.cloud_preview_reset_zoom)
        val zoomLabel = stringResource(R.string.preview_image_zoom_value, (transform.zoom * 100).toInt())
        Image(bitmap.asImageBitmap(), contentDescription = name, contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize().testTag("preview-image-ready")
                .semantics {
                    stateDescription = zoomLabel
                    customActions = listOf(
                        CustomAccessibilityAction(zoomIn) { update(transform.atZoom(transform.zoom * 1.25f)); true },
                        CustomAccessibilityAction(zoomOut) { update(transform.atZoom(transform.zoom / 1.25f)); true },
                        CustomAccessibilityAction(rotateLeft) { update(transform.rotate(-90)); true },
                        CustomAccessibilityAction(rotateRight) { update(transform.rotate(90)); true },
                        CustomAccessibilityAction(flipH) { update(transform.copy(flipH = !transform.flipH)); true },
                        CustomAccessibilityAction(flipV) { update(transform.copy(flipV = !transform.flipV)); true },
                        CustomAccessibilityAction(reset) { update(ImageTransform()); true }
                    )
                }
                .pointerInput(bitmap, width, height) {
                    imageTransformGestures(canPan = { !transform.allowsPaging }) { focal, delta, scale ->
                        val next = transform.atZoom(transform.zoom * scale, focal.x - width / 2, focal.y - height / 2)
                        update(next.copy(x = next.x + delta.x, y = next.y + delta.y))
                    }
                }.pointerInput(bitmap, width, height) {
                    detectTapGestures(onDoubleTap = { focal ->
                        update(if (transform.zoom > 1f) transform.copy(zoom = 1f, x = 0f, y = 0f)
                            else transform.atZoom(2.5f, focal.x - width / 2, focal.y - height / 2))
                    })
                }.graphicsLayer {
                    scaleX = transform.zoom * if (transform.flipH) -1f else 1f
                    scaleY = transform.zoom * if (transform.flipV) -1f else 1f
                    rotationZ = transform.rotation.toFloat()
                    translationX = transform.x; translationY = transform.y
                })
        Surface(Modifier.align(Alignment.BottomCenter).fillMaxWidth(), color = MaterialTheme.colorScheme.surface.copy(alpha = .9f)) {
            LazyRow(Modifier.testTag("preview-image-tools"), verticalAlignment = Alignment.CenterVertically,
                contentPadding = PaddingValues(horizontal = 8.dp)) {
                item { IconButton(onClick = { update(transform.atZoom(transform.zoom / 1.25f)) }, Modifier.size(48.dp)) { Icon(Icons.Default.ZoomOut, zoomOut) } }
                item { Text(zoomLabel, Modifier.widthIn(min = 56.dp), style = MaterialTheme.typography.labelMedium) }
                item { IconButton(onClick = { update(transform.atZoom(transform.zoom * 1.25f)) }, Modifier.size(48.dp)) { Icon(Icons.Default.ZoomIn, zoomIn) } }
                item { IconButton(onClick = { update(transform.rotate(-90)) }, Modifier.size(48.dp)) { Icon(Icons.Default.RotateLeft, rotateLeft) } }
                item { IconButton(onClick = { update(transform.rotate(90)) }, Modifier.size(48.dp)) { Icon(Icons.Default.RotateRight, rotateRight) } }
                item { IconToggleButton(transform.flipH, { update(transform.copy(flipH = it)) }, Modifier.size(48.dp)) { Icon(Icons.Default.Flip, flipH) } }
                item { IconToggleButton(transform.flipV, { update(transform.copy(flipV = it)) }, Modifier.size(48.dp)) { Icon(Icons.Default.Flip, flipV) } }
                if (transform != ImageTransform()) item {
                    IconButton(onClick = { update(ImageTransform()) }, Modifier.size(48.dp).testTag("preview-image-reset")) { Icon(Icons.Default.RestartAlt, reset) }
                }
            }
        }
    }
}
