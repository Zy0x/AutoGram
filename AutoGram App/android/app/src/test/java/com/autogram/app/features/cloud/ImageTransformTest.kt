package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.preview.image.*
import org.junit.Assert.*
import org.junit.Test

class ImageTransformTest {
    @Test fun focalPointStaysUnderFingerWhenZooming() {
        val next = ImageTransform().atZoom(2.5f, 60f, -40f)
        assertEquals(-90f, next.x, .001f)
        assertEquals(60f, next.y, .001f)
        assertEquals(60f, 60f * next.zoom + next.x, .001f)
    }
    @Test fun zoomRangeAndPanAreBounded() {
        assertEquals(.25f, ImageTransform().atZoom(.01f).zoom, 0f)
        assertEquals(8f, ImageTransform().atZoom(80f).zoom, 0f)
        val clamped = ImageTransform(zoom = 2f, x = 900f, y = -900f).bounded(300f, 200f, 300f, 300f)
        assertEquals(150f, clamped.x, .001f); assertEquals(-50f, clamped.y, .001f)
        val fit = clamped.atZoom(.25f).bounded(300f, 200f, 300f, 300f)
        assertEquals(0f, fit.x, 0f); assertEquals(0f, fit.y, 0f)
        assertTrue(fit.allowsPaging); assertFalse(clamped.allowsPaging)
    }
    @Test fun rotationWrapAndRotatedBoundsPreserveBothFlips() {
        val rotated = ImageTransform(zoom = 2f, x = 900f, y = -900f, flipH = true, flipV = true).rotate(-90)
            .bounded(300f, 200f, 300f, 300f)
        assertEquals(270, rotated.rotation); assertEquals(50f, rotated.x, .001f)
        assertEquals(-150f, rotated.y, .001f); assertTrue(rotated.flipH && rotated.flipV)
        assertEquals(0, rotated.rotate(90).rotation)
    }
    @Test fun samplingBoundsHugeDimensionsAndArgbAllocation() {
        assertEquals(1, imageSampleSize(800, 400))
        val sample = imageSampleSize(16000, 12000)
        assertTrue(16000 / sample <= 4096 && 12000 / sample <= 4096)
        assertTrue((16000 / sample).toLong() * (12000 / sample) * 4 <= 32L * 1024 * 1024)
        assertTrue(imageSampleSize(4096, 4096) > 1)
    }
}
