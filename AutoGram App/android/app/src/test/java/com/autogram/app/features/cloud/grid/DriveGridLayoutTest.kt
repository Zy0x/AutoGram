package com.autogram.app.features.cloud.grid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DriveGridLayoutTest {
    @Test fun allDesktopDensityPresetsProduceTheExpectedWidthsAndCaps() {
        val medium = computeDriveGridLayout(1200f, DriveGridDensity.MEDIUM)
        assertEquals(7, medium.columns)
        assertEquals(158.86f, medium.cardWidthDp, .02f)
        assertEquals(238f, medium.cardHeightDp, .01f)
        assertEquals(12, computeDriveGridLayout(1400f, DriveGridDensity.EXTRA_SMALL).columns)
        assertEquals(10, computeDriveGridLayout(1400f, DriveGridDensity.SMALL).columns)
        assertEquals(6, computeDriveGridLayout(1400f, DriveGridDensity.LARGE).columns)
        assertEquals(5, computeDriveGridLayout(1400f, DriveGridDensity.EXTRA_LARGE).columns)
        assertEquals(4, computeDriveGridLayout(1400f, DriveGridDensity.MAXIMUM).columns)
    }

    @Test fun narrowAndInvalidWidthsNeverOverflowOrReturnInvalidDimensions() {
        val narrow = computeDriveGridLayout(250f, DriveGridDensity.EXTRA_SMALL)
        assertEquals(2, narrow.columns)
        val tiny = computeDriveGridLayout(200f, DriveGridDensity.EXTRA_SMALL)
        assertEquals(1, tiny.columns)
        val invalid = computeDriveGridLayout(Float.NaN, DriveGridDensity.MEDIUM)
        assertEquals(computeDriveGridLayout(800f, DriveGridDensity.MEDIUM), invalid)
        listOf(narrow, tiny, invalid).forEach {
            assertTrue(it.cardWidthDp.isFinite() && it.cardWidthDp > 0f)
            assertTrue(it.cardHeightDp.isFinite() && it.cardHeightDp > it.cardWidthDp)
            assertEquals(it.cardHeightDp + 10f, it.rowHeightDp, .01f)
        }
    }

    @Test fun pinchZoomUsesDesktopDirectionThresholdsAndClampsAtBothEnds() {
        assertEquals(DriveGridDensity.SMALL, driveGridDensityAfterPinch(DriveGridDensity.MEDIUM, 1.20f))
        assertEquals(DriveGridDensity.LARGE, driveGridDensityAfterPinch(DriveGridDensity.MEDIUM, 0.83f))
        assertEquals(null, driveGridDensityAfterPinch(DriveGridDensity.MEDIUM, 1.1f))
        assertEquals(null, driveGridDensityAfterPinch(DriveGridDensity.EXTRA_SMALL, 1.5f))
        assertEquals(null, driveGridDensityAfterPinch(DriveGridDensity.MAXIMUM, 0.5f))
        assertEquals(null, driveGridDensityAfterPinch(DriveGridDensity.MEDIUM, Float.NaN))
    }
}
