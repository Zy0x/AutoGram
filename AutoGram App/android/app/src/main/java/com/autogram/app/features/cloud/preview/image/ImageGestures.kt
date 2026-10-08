package com.autogram.app.features.cloud.preview.image

import androidx.compose.foundation.gestures.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.positionChanged

/** A base-scale one-finger swipe belongs to the parent pager, not the image. */
internal suspend fun PointerInputScope.imageTransformGestures(
    canPan: () -> Boolean,
    onTransform: (Offset, Offset, Float) -> Unit
) = awaitEachGesture {
    awaitFirstDown(requireUnconsumed = false)
    var active = false
    var totalPan = Offset.Zero
    var totalZoom = 1f
    do {
        val event = awaitPointerEvent()
        if (event.changes.any { it.isConsumed }) break
        val zoom = event.calculateZoom()
        val pan = event.calculatePan()
        val multiTouch = event.changes.count { it.pressed } > 1
        totalPan += pan
        totalZoom *= zoom
        if (!active) {
            val zoomMotion = kotlin.math.abs(1f - totalZoom) * event.calculateCentroidSize(useCurrent = false)
            active = (multiTouch && (zoomMotion > viewConfiguration.touchSlop || totalPan.getDistance() > viewConfiguration.touchSlop)) ||
                (canPan() && totalPan.getDistance() > viewConfiguration.touchSlop)
        }
        if (active && (zoom != 1f || pan != Offset.Zero)) {
            val focal = event.calculateCentroid(useCurrent = false)
            if (focal.isSpecified) onTransform(focal, pan, zoom)
            event.changes.forEach { if (it.positionChanged()) it.consume() }
        }
    } while (event.changes.any { it.pressed })
}
