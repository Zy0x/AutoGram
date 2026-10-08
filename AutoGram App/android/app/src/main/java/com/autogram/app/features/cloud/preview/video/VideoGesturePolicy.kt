package com.autogram.app.features.cloud.preview.video

import kotlin.math.abs
import kotlin.math.max

internal enum class VideoGestureMode { PENDING, SEEK, VOLUME, BRIGHTNESS, GALLERY, BOOST, CANCELLED }

/** Disjoint intent zones; speed alone must never turn an ordinary seek into paging. */
internal object VideoGesturePolicy {
    fun classify(startX: Float, width: Float, dx: Float, dy: Float, pointers: Int, threshold: Float): VideoGestureMode {
        if (max(abs(dx), abs(dy)) < threshold) return VideoGestureMode.PENDING
        if (abs(dx) > abs(dy) * 1.5f) return if (pointers > 1 || startX < width * .12f || startX > width * .88f)
            VideoGestureMode.GALLERY else VideoGestureMode.SEEK
        if (abs(dy) > abs(dx) * 1.5f && pointers == 1) return when {
            startX < width / 3 -> VideoGestureMode.BRIGHTNESS
            startX > width * 2 / 3 -> VideoGestureMode.VOLUME
            else -> VideoGestureMode.CANCELLED
        }
        return VideoGestureMode.PENDING
    }
    fun galleryDelta(dx: Float, dy: Float, width: Float, minPixels: Float, elapsedMs: Long): Int {
        if (elapsedMs > 1600 || abs(dx) < max(width * .28f, minPixels) || abs(dx) < abs(dy) * 1.8f) return 0
        return if (dx < 0) 1 else -1
    }
    fun seekTarget(position: Long, duration: Long, dx: Float, width: Float): Long {
        if (duration <= 0 || width <= 0) return position.coerceAtLeast(0)
        val span = minOf(duration, 120_000)
        return (position + (dx / width * span).toLong()).coerceIn(0, (duration - 1).coerceAtLeast(0))
    }
    fun boostedSpeed(base: Float) = (base * 2f).coerceIn(1f, 4f)
}
