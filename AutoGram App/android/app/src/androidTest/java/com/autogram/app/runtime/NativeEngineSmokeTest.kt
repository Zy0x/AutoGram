package com.autogram.app.runtime

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.autogram_android_bridge.getRuntimeStatus
import uniffi.autogram_android_bridge.getStorageBudget
import uniffi.autogram_android_bridge.listDriveItems
import uniffi.autogram_android_bridge.listTransferTasks
import uniffi.autogram_android_bridge.planBatchExecutionSummary
import org.json.JSONObject
import java.io.File

/** Runs against the packaged library, not a JVM fake. Does not contact Telegram. */
@RunWith(AndroidJUnit4::class)
class NativeEngineSmokeTest {
    @Test
    fun packagedBridgeInitializesAndExecutesNativeCalls() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val status = getRuntimeStatus()
        assertTrue(status.initialized)
        assertEquals(File(context.filesDir, "telegram_migrator.db").canonicalPath,
            File(status.databasePath).canonicalPath)
        assertEquals(NativeRuntimeStatus.READY, NativeRuntime.status.value)
        assertTrue(getStorageBudget().maxTempBytes > 0uL)
        assertTrue(listDriveItems("instrumentation-no-session", "no-peer", null, "/").isEmpty())
        // Exercises SQLite and record conversion without mutating existing records.
        listTransferTasks()
        val plan = JSONObject(planBatchExecutionSummary(2u, 100uL))
        assertEquals(2, plan.getInt("totalFiles"))
        assertEquals(100L, plan.getLong("totalBytes"))
    }
}
