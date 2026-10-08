package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.preview.video.*
import org.junit.Assert.*
import org.junit.Test

class VideoGesturePolicyTest {
    @Test fun smallDiagonalAndCentralMovementNeverPages() {
        assertEquals(VideoGestureMode.PENDING, VideoGesturePolicy.classify(500f, 1000f, 20f, 0f, 1, 24f))
        assertEquals(VideoGestureMode.PENDING, VideoGesturePolicy.classify(500f, 1000f, 50f, 50f, 1, 24f))
        assertEquals(VideoGestureMode.SEEK, VideoGesturePolicy.classify(500f, 1000f, -450f, 0f, 1, 24f))
    }
    @Test fun galleryHasExplicitZonesAndHigherThreshold() {
        assertEquals(VideoGestureMode.GALLERY, VideoGesturePolicy.classify(80f, 1000f, 80f, 0f, 1, 24f))
        assertEquals(VideoGestureMode.GALLERY, VideoGesturePolicy.classify(500f, 1000f, -80f, 0f, 2, 24f))
        assertEquals(0, VideoGesturePolicy.galleryDelta(-200f, 0f, 1000f, 72f, 500))
        assertEquals(1, VideoGesturePolicy.galleryDelta(-350f, 20f, 1000f, 72f, 1000))
        assertEquals(-1, VideoGesturePolicy.galleryDelta(350f, 0f, 1000f, 72f, 1000))
        assertEquals(0, VideoGesturePolicy.galleryDelta(-350f, 250f, 1000f, 72f, 500))
        assertEquals(0, VideoGesturePolicy.galleryDelta(-350f, 0f, 1000f, 72f, 1700))
    }
    @Test fun verticalZonesAreDisjointFromSeek() {
        assertEquals(VideoGestureMode.BRIGHTNESS, VideoGesturePolicy.classify(100f, 1000f, 0f, -100f, 1, 24f))
        assertEquals(VideoGestureMode.VOLUME, VideoGesturePolicy.classify(900f, 1000f, 0f, -100f, 1, 24f))
        assertEquals(VideoGestureMode.CANCELLED, VideoGesturePolicy.classify(500f, 1000f, 0f, -100f, 1, 24f))
    }
    @Test fun seekClampsAndDoesNotJumpAcrossLongMovie() {
        assertEquals(110000L, VideoGesturePolicy.seekTarget(50000, 3600000, 500f, 1000f))
        assertEquals(0L, VideoGesturePolicy.seekTarget(1000, 200000, -1000f, 1000f))
        assertEquals(9999L, VideoGesturePolicy.seekTarget(9000, 10000, 1000f, 1000f))
        assertEquals(50000L, VideoGesturePolicy.seekTarget(50000, 0, 300f, 1000f))
        assertEquals(3f, VideoGesturePolicy.boostedSpeed(1.5f), 0f)
        assertEquals(4f, VideoGesturePolicy.boostedSpeed(3f), 0f)
    }
}
