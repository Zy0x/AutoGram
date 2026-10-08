package com.autogram.app.features.cloud.preview

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
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
import com.autogram.app.R
import com.autogram.app.features.cloud.preview.image.*
import com.autogram.app.features.cloud.preview.controls.*

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
        val updateLatest by rememberUpdatedState<(ImageTransform) -> Unit> { update(it) }
        val tools = remember(transform, rotateLeft, rotateRight, flipH, flipV, reset) { listOf(
            PreviewTool("image.rotate_left", rotateLeft) { updateLatest(transform.rotate(-90)) },
            PreviewTool("image.rotate_right", rotateRight) { updateLatest(transform.rotate(90)) },
            PreviewTool("image.flip_h", flipH, checked = transform.flipH) { updateLatest(transform.copy(flipH = !transform.flipH)) },
            PreviewTool("image.flip_v", flipV, checked = transform.flipV) { updateLatest(transform.copy(flipV = !transform.flipV)) },
            PreviewTool("image.reset", reset, enabled = transform != ImageTransform()) { updateLatest(ImageTransform()) }
        ) }
        PublishPreviewTools(tools)
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
        StandalonePreviewTools(tools, Modifier.align(Alignment.TopEnd))
    }
}
