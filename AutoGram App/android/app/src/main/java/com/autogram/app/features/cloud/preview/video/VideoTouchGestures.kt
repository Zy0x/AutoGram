package com.autogram.app.features.cloud.preview.video

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.positionChanged
import kotlin.math.max

internal data class VideoGestureCallbacks(
    val locked: () -> Boolean,
    val canSeek: () -> Boolean,
    val position: () -> Long,
    val duration: () -> Long,
    val previewSeek: (Long?) -> Unit,
    val commitSeek: (Long) -> Unit,
    val boost: (Boolean) -> Unit,
    val volume: (Float) -> Unit,
    val brightness: (Float) -> Unit,
    val navigate: (Int) -> Boolean,
    val finish: () -> Unit,
    val epoch: () -> Int = { 0 }
)

/** One committed seek per completed drag. Hold and gallery are exclusive owners. */
internal suspend fun PointerInputScope.videoTouchGestures(density: Float, callbacks: VideoGestureCallbacks) = awaitEachGesture {
    val down = awaitFirstDown(requireUnconsumed = false)
    var mode = if (callbacks.locked()) VideoGestureMode.CANCELLED else VideoGestureMode.PENDING
    var travel = Offset.Zero
    var last = down.position
    var lastTime = down.uptimeMillis
    val startPosition = callbacks.position()
    val duration = callbacks.duration()
    val epoch = callbacks.epoch()
    var seekTarget: Long? = null
    var holdEligible = mode == VideoGestureMode.PENDING
    var boosting = false
    var cancelled = false
    val threshold = max(viewConfiguration.touchSlop * 2, 24f * density)
    try {
        while (true) {
            val remainingHold = (viewConfiguration.longPressTimeoutMillis - (lastTime - down.uptimeMillis)).coerceAtLeast(1)
            val event = if (holdEligible && mode == VideoGestureMode.PENDING) {
                withTimeoutOrNull(remainingHold) { awaitPointerEvent() }
            } else awaitPointerEvent()
            if (event == null) {
                holdEligible = false
                if (callbacks.canSeek() && !callbacks.locked() && callbacks.epoch() == epoch) {
                    mode = VideoGestureMode.BOOST; boosting = true; callbacks.boost(true)
                } else mode = VideoGestureMode.CANCELLED
                continue
            }
            if (callbacks.locked() || callbacks.epoch() != epoch) { cancelled = true; mode = VideoGestureMode.CANCELLED }
            val change = event.changes.firstOrNull { it.id == down.id }
            val pointers = event.changes.count { it.pressed }
            if (change != null) {
                val delta = change.position - last
                last = change.position; lastTime = change.uptimeMillis
                travel += delta
                if (change.isConsumed && delta != Offset.Zero) { cancelled = true; break }
                if (travel.getDistance() > viewConfiguration.touchSlop || pointers > 1) holdEligible = false
                if (pointers > 1 && mode !in setOf(VideoGestureMode.PENDING, VideoGestureMode.GALLERY)) {
                    cancelled = true; mode = VideoGestureMode.CANCELLED
                }
                if (mode == VideoGestureMode.PENDING) mode = VideoGesturePolicy.classify(
                    down.position.x, size.width.toFloat(), travel.x, travel.y, pointers, threshold)
                when (mode) {
                    VideoGestureMode.SEEK -> if (callbacks.canSeek()) {
                        seekTarget = VideoGesturePolicy.seekTarget(startPosition, duration, travel.x, size.width.toFloat())
                        callbacks.previewSeek(seekTarget)
                    }
                    VideoGestureMode.VOLUME -> callbacks.volume(-delta.y / size.height.coerceAtLeast(1))
                    VideoGestureMode.BRIGHTNESS -> callbacks.brightness(-delta.y / size.height.coerceAtLeast(1))
                    else -> Unit
                }
                if (boosting && (!change.pressed || pointers > 1)) { callbacks.boost(false); boosting = false }
            }
            if (mode != VideoGestureMode.PENDING) event.changes.forEach { if (it.positionChanged()) it.consume() }
            if (event.changes.none { it.pressed }) break
        }
        if (!cancelled && !callbacks.locked() && callbacks.epoch() == epoch) when (mode) {
            VideoGestureMode.SEEK -> seekTarget?.let(callbacks.commitSeek)
            VideoGestureMode.GALLERY -> {
                val direction = VideoGesturePolicy.galleryDelta(travel.x, travel.y, size.width.toFloat(), 72f * density, lastTime - down.uptimeMillis)
                if (direction != 0) callbacks.navigate(direction)
            }
            else -> Unit
        }
    } finally {
        if (boosting) callbacks.boost(false)
        callbacks.previewSeek(null)
        callbacks.finish()
    }
}
