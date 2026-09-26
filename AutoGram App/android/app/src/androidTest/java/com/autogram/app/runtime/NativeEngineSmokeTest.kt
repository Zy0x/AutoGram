package com.autogram.app.runtime

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.autogram_android_bridge.getRuntimeStatus
import uniffi.autogram_android_bridge.getStorageBudget
import uniffi.autogram_android_bridge.listDriveItems
import uniffi.autogram_android_bridge.listTransferTasks
import uniffi.autogram_android_bridge.listSessionSummaries
import uniffi.autogram_android_bridge.planBatchExecutionSummary
import org.json.JSONObject
import java.io.File
import android.system.Os
import java.util.UUID

/** Runs against the packaged library, not a JVM fake. Does not contact Telegram. */
@RunWith(AndroidJUnit4::class)
class NativeEngineSmokeTest {
    @Test
    fun installedPackageMatchesGeneratedReleaseVersion() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        assertEquals(BuildConfig.VERSION_NAME, info.versionName)
        @Suppress("DEPRECATION")
        val installedCode = info.versionCode
        val parts = BuildConfig.VERSION_NAME.split('.').map { it.toInt() }
        assertEquals(parts[0] * 10_000 + parts[1] * 100 + parts[2], installedCode)
    }

    @Test
    fun inventoryRejectsLinkedOrDirectorySessionsOnPackagedEngine() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val root = File(context.filesDir, "sessions")
        root.mkdirs()
        val prefix = "instrumentation-${UUID.randomUUID()}"
        val regular = File(root, "$prefix.grammers.json")
        val legacy = File(root, "$prefix.session")
        val directory = File(root, "$prefix-directory.session")
        val link = File(root, "$prefix-link.session")
        val broken = File(root, "$prefix-broken.session")
        val preview = File(root, "${prefix}_preview.grammers.json")
        try {
            regular.writeText("deliberately invalid dummy session")
            legacy.writeText("dummy migration source")
            preview.writeText("dummy preview")
            assertTrue(directory.mkdir())
            Os.symlink(regular.absolutePath, link.absolutePath)
            Os.symlink(File(root, "$prefix-missing").absolutePath, broken.absolutePath)
            val items = listSessionSummaries().filter { it.name.startsWith(prefix) }
            assertEquals(1, items.size)
            assertEquals(prefix, items.single().name)
            assertEquals("unverified", items.single().status)
            assertEquals("grammers+migration_source", items.single().source)
        } finally {
            // Remove only this test's UUID-named fixtures; never clear the sessions root.
            listOf(link, broken, regular, legacy, directory, preview).forEach { it.delete() }
        }
    }

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
        // Inventory is metadata only; no returned record proves a Telegram login.
        assertTrue(listSessionSummaries().all {
            it.status == "unverified" || it.status == "migration_required"
        })
        val plan = JSONObject(planBatchExecutionSummary(2u, 100uL))
        assertEquals(2, plan.getInt("totalFiles"))
        assertEquals(100L, plan.getLong("totalBytes"))
    }
}
