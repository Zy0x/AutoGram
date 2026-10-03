package com.autogram.app.cloud

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.autogram_android_bridge.*

/** Packaged JNI, never a real session or simulated transfer. */
@RunWith(AndroidJUnit4::class)
class CloudDownloadBridgeTest {
    @Test fun offlineMetadataDoesNotAuthorizeQueueCreation() = runBlocking {
        val before = listCloudDownloads("tg_987654321").size
        try {
            enqueueCloudDownload("tg_987654321", "me", null, 1)
            fail("A verified live account must be required")
        } catch (expected: NativeDownloadException.RequestFailed) {
            assertEquals("account_not_selected", expected.code)
        }
        assertEquals(before, listCloudDownloads("tg_987654321").size)
    }
    @Test fun legacyIdentityAndUnknownOperationsFailClosed() {
        assertThrows(NativeDownloadException::class.java) { listCloudDownloads("old-local-account") }
        assertThrows(NativeDownloadException::class.java) { controlCloudDownload("tg_987654321", "missing", "retry") }
    }
}
