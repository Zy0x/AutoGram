package com.autogram.app.features.cloudtransfer.upload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.autogram_android_bridge.NativeAlbumPacking

class PhotoAlbumPackingTest {
    private fun settings(policy: NativeAlbumPacking, size: UInt = 10u, avoidSingle: Boolean = true) =
        documentSettings("Photo album").copy(
            groupAsAlbum = true,
            albumPacking = policy,
            albumGroupSize = size,
            albumAvoidSingle = avoidSingle,
        )

    @Test fun maximumUsesTenAndRebalancesAOnePhotoRemainder() {
        val plan = planPhotoAlbumPacking(21, settings(NativeAlbumPacking.MAXIMUM))
        assertEquals(listOf(10, 9, 2), plan.groupSizes)
        assertEquals(0, plan.separateItems)
    }

    @Test fun customGridUsesSavedSizeAndAvoidsSinglePhotoRemainder() {
        val plan = planPhotoAlbumPacking(15, settings(NativeAlbumPacking.CUSTOM, 7u))
        assertEquals(listOf(7, 6, 2), plan.groupSizes)
        assertEquals(0, plan.separateItems)
    }

    @Test fun balancedPhotoPolicyMatchesDesktopSmartAdaptive() {
        val plan = planPhotoAlbumPacking(17, settings(NativeAlbumPacking.BALANCED))
        val desktopSmart = planPhotoAlbumPacking(17, settings(NativeAlbumPacking.SMART_ADAPTIVE))
        assertEquals(listOf(10, 7), plan.groupSizes)
        assertEquals(desktopSmart, plan)
        assertEquals(0, plan.separateItems)
    }

    @Test fun customGridTwoReportsUnavoidableSingleWhenCountIsOdd() {
        val plan = planPhotoAlbumPacking(5, settings(NativeAlbumPacking.CUSTOM, 2u))
        assertEquals(listOf(2, 2), plan.groupSizes)
        assertEquals(1, plan.separateItems)
    }

    @Test fun everyPlannedGroupRespectsTelegramVisualAlbumLimit() {
        for (policy in listOf(NativeAlbumPacking.SMART_ADAPTIVE, NativeAlbumPacking.MAXIMUM,
            NativeAlbumPacking.BALANCED, NativeAlbumPacking.CUSTOM, NativeAlbumPacking.FOLLOW_SELECTION)) {
            val plan = planPhotoAlbumPacking(73, settings(policy, 7u))
            assertTrue(plan.groupSizes.all { it in 2..10 })
            assertEquals(73, plan.groupSizes.sum() + plan.separateItems)
        }
    }
}
