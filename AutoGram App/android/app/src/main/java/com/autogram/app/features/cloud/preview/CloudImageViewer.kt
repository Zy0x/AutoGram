package com.autogram.app.features.cloud.preview

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R

/** Pinch/pan and double-tap only the decoded image, never its navigation chrome. */
@Composable
internal fun CloudImageViewer(bitmap: Bitmap, name: String) {
    var zoom by remember(bitmap) { mutableFloatStateOf(1f) }
    var pan by remember(bitmap) { mutableStateOf(Offset.Zero) }
    BoxWithConstraints(Modifier.fillMaxSize().clipToBounds()) {
        val density = LocalDensity.current
        val width = with(density) { maxWidth.toPx() }
        val height = with(density) { maxHeight.toPx() }
        val fit = minOf(width / bitmap.width, height / bitmap.height)
        val imageWidth = bitmap.width * fit
        val imageHeight = bitmap.height * fit
        Image(bitmap.asImageBitmap(), contentDescription = name, contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize().testTag("preview-image-ready")
                .pointerInput(bitmap, width, height) {
                    detectTransformGestures { _, delta, scale, _ ->
                        zoom = (zoom * scale).coerceIn(1f, 6f)
                        val limitX = ((imageWidth * zoom - width) / 2).coerceAtLeast(0f)
                        val limitY = ((imageHeight * zoom - height) / 2).coerceAtLeast(0f)
                        pan = Offset((pan.x + delta.x).coerceIn(-limitX, limitX),
                            (pan.y + delta.y).coerceIn(-limitY, limitY))
                    }
                }.pointerInput(bitmap) {
                    detectTapGestures(onDoubleTap = { zoom = if (zoom > 1f) 1f else 2f; pan = Offset.Zero })
                }.graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y })
        if (zoom > 1f) TextButton(onClick = { zoom = 1f; pan = Offset.Zero },
            modifier = Modifier.align(Alignment.TopEnd).heightIn(min = 48.dp)) {
            Text(stringResource(R.string.cloud_preview_reset_zoom))
        }
    }
}
