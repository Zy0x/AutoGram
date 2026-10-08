package com.autogram.app.features.cloud.preview.image

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/** Pure viewport-space policy: no bitmap, network or Compose lifetime. */
data class ImageTransform(
    val zoom: Float = 1f,
    val x: Float = 0f,
    val y: Float = 0f,
    val rotation: Int = 0,
    val flipH: Boolean = false,
    val flipV: Boolean = false
) {
    val allowsPaging: Boolean get() = zoom <= 1f

    fun bounded(imageWidth: Float, imageHeight: Float, width: Float, height: Float): ImageTransform {
        val angle = Math.toRadians(rotation.toDouble())
        val rotatedWidth = abs(cos(angle)).toFloat() * imageWidth + abs(sin(angle)).toFloat() * imageHeight
        val rotatedHeight = abs(sin(angle)).toFloat() * imageWidth + abs(cos(angle)).toFloat() * imageHeight
        val safeZoom = zoom.coerceIn(.25f, 8f)
        val limitX = ((rotatedWidth * safeZoom - width) / 2).coerceAtLeast(0f)
        val limitY = ((rotatedHeight * safeZoom - height) / 2).coerceAtLeast(0f)
        return copy(zoom = safeZoom, x = x.coerceIn(-limitX, limitX), y = y.coerceIn(-limitY, limitY))
    }

    fun atZoom(value: Float, focalX: Float = 0f, focalY: Float = 0f): ImageTransform {
        val target = value.coerceIn(.25f, 8f)
        val ratio = target / zoom
        return copy(zoom = target, x = focalX + (x - focalX) * ratio, y = focalY + (y - focalY) * ratio)
    }

    fun rotate(degrees: Int) = copy(rotation = ((rotation + degrees) % 360 + 360) % 360)
}

fun imageSampleSize(width: Int, height: Int, maxEdge: Int = 4096, maxPixels: Long = 8_388_608): Int {
    require(width > 0 && height > 0 && maxEdge > 0 && maxPixels > 0)
    var sample = 1
    while ((width.toLong() + sample - 1) / sample > maxEdge || (height.toLong() + sample - 1) / sample > maxEdge ||
        ((width.toLong() + sample - 1) / sample) * ((height.toLong() + sample - 1) / sample) > maxPixels) sample *= 2
    return sample
}
