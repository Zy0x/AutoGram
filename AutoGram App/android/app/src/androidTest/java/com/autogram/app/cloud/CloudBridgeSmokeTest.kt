package com.autogram.app.cloud

import com.autogram.app.runtime.NativeRuntime
import com.autogram.app.runtime.NativeRuntimeStatus
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import uniffi.autogram_android_bridge.*

/** Packaged JNI contracts fail closed without a verified account; no Telegram RPC is sent. */
class CloudBridgeSmokeTest {
    private suspend fun rejected(expected: String, request: suspend () -> Unit) {
        try { request(); fail("unverified cloud request must not return success") }
        catch (error: NativeAuthException.RequestFailed) { assertEquals(expected, error.code) }
    }

    @Test fun packagedCloudContractsDoNotUseLocalRecordsAsAuthorization() = runBlocking {
        assertEquals(NativeRuntimeStatus.READY, NativeRuntime.status.value)
        rejected("account_not_selected") { listCloudDialogs("tg_1", null) }
        rejected("account_not_selected") { listCloudMedia("tg_1", "me", 0, "") }
        rejected("account_not_selected") { openCloudMediaStream("tg_1", "me", 1) }
        rejected("cloud_stream_closed") { readCloudMediaRange("tg_1", "test-absent-handle", 0uL, 4096u) }
        closeCloudMediaStream("tg_1", "test-absent-handle")
    }
}
