package com.autogram.app.runtime

import android.os.StatFs
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.autogram_android_bridge.getAvailableStorageBytes
import uniffi.autogram_android_bridge.getHardwareProfiles

/** Read-only packaged-engine checks. No credentials, account changes or cloud writes. */
@RunWith(AndroidJUnit4::class)
class NativePlatformEvidenceTest {
    @Test
    fun storageCapacityMatchesPhoneFilesystemInsteadOfFixedQuota() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val before = StatFs(context.filesDir.absolutePath).availableBytes.toULong()
        val actual = getAvailableStorageBytes()
        val after = StatFs(context.filesDir.absolutePath).availableBytes.toULong()
        val margin = 64uL * 1024uL * 1024uL
        val lower = minOf(before, after)
        val upper = maxOf(before, after)
        assertTrue(actual + margin >= lower && actual <= upper + margin)
    }

    @Test
    fun unprobedAndroidEncoderDoesNotReturnManufacturedSuccess() {
        try {
            getHardwareProfiles()
            fail("Unprobed encoder must not report an executable profile")
        } catch (error: uniffi.autogram_android_bridge.AutoGramBridgeException.MediaException) {
            assertTrue(error.message.orEmpty().contains("android_encoder_probe_unavailable"))
        }
    }
}
