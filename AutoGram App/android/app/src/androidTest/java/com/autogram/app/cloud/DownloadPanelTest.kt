package com.autogram.app.cloud

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.runtime.mutableStateOf
import androidx.test.platform.app.InstrumentationRegistry
import android.Manifest
import android.os.Build
import android.content.pm.PackageManager
import android.content.Context
import com.autogram.app.R
import com.autogram.app.features.cloudtransfer.DownloadPanel
import com.autogram.app.features.cloudtransfer.services.DownloadQueue
import com.autogram.app.viewmodel.DriveFileItem
import uniffi.autogram_android_bridge.NativeCloudDownload
import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import com.autogram.app.theme.AutoGramTheme
import org.junit.Rule
import org.junit.Test
import org.junit.Before

class DownloadPanelTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    /** The reviewed runner supplies/restores any temporary grant outside the target process.
     * Revoking it inside @After would kill the instrumentation UID and lose test evidence.
     */
    @Before fun requireTestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            org.junit.Assert.assertEquals("Runner must preserve the original notification choice",
                PackageManager.PERMISSION_GRANTED,
                instrumentation.targetContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
        }
    }
    @Test fun absentAccountCannotOpenQueue() {
        compose.setContent { AutoGramTheme { DownloadPanel("", null, {}) } }
        compose.onNodeWithText(compose.activity.getString(R.string.cloud_download_title)).assertIsNotEnabled()
    }
    @Test fun realEmptyNativeQueueHasClosableDialogNoInventedProgress() {
        compose.setContent { AutoGramTheme { DownloadPanel("tg_987654321", null, {}) } }
        compose.onNodeWithText(compose.activity.getString(R.string.cloud_download_title)).performClick()
        compose.waitUntil(5000) {
            compose.onAllNodesWithText(compose.activity.getString(R.string.cloud_download_empty)).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(compose.activity.getString(R.string.cloud_download_empty)).assertIsDisplayed()
        compose.onNodeWithText(compose.activity.getString(R.string.native_close)).performClick()
        compose.onNodeWithText(compose.activity.getString(R.string.cloud_download_empty)).assertDoesNotExist()
    }

    @Test fun consumingSelectionCannotCancelAnAcceptedDownloadAction() {
        val queue = WaitingQueue()
        val selected = mutableStateOf<DriveFileItem?>(fixtureItem())
        compose.setContent { AutoGramTheme {
            DownloadPanel("tg_987654321", selected.value, { selected.value = null }, queue)
        } }
        compose.waitUntil(5000) { queue.started.isCompleted && selected.value == null }
        compose.waitForIdle()
        queue.finish.complete(Unit)
        compose.waitUntil(5000) { queue.wakes.get() == 1 }
        org.junit.Assert.assertFalse(queue.cancelled.get())
    }

    @Test fun accountChangeCancelsPreflightAndCannotWakeOldAccountWork() {
        val queue = WaitingQueue()
        val selected = mutableStateOf<DriveFileItem?>(fixtureItem())
        val account = mutableStateOf("tg_987654321")
        compose.setContent { AutoGramTheme {
            DownloadPanel(account.value, selected.value, { selected.value = null }, queue)
        } }
        compose.waitUntil(5000) { queue.started.isCompleted }
        compose.runOnIdle { account.value = "tg_987654322" }
        compose.waitUntil(5000) { queue.cancelled.get() }
        queue.finish.complete(Unit)
        compose.waitForIdle()
        org.junit.Assert.assertEquals(0, queue.wakes.get())
    }

    private fun fixtureItem() = DriveFileItem("fixture", "synthetic.bin", 10,
        "application/octet-stream", false, 0, cloudAccountId = "tg_987654321",
        cloudPeerId = "me", cloudMessageId = 1)

    @Test fun accountChangeCancelsEveryConcurrentPreflightNotOnlyTheLatest() {
        val queue = WaitingQueue()
        val selected = mutableStateOf<DriveFileItem?>(fixtureItem())
        val account = mutableStateOf("tg_987654321")
        compose.setContent { AutoGramTheme {
            DownloadPanel(account.value, selected.value, { selected.value = null }, queue)
        } }
        compose.waitUntil(5000) { queue.starts.get() == 1 }
        compose.runOnIdle { selected.value = fixtureItem().copy(id = "fixture-second", cloudMessageId = 2) }
        compose.waitUntil(5000) { queue.starts.get() == 2 }
        compose.runOnIdle { account.value = "tg_987654322" }
        compose.waitUntil(5000) { queue.cancellations.get() == 2 }
        queue.finish.complete(Unit)
        compose.waitForIdle()
        org.junit.Assert.assertEquals(0, queue.wakes.get())
    }

    /** Synchronization fixture exists only in the instrumentation source set, never production. */
    private class WaitingQueue : DownloadQueue {
        val started = CompletableDeferred<Unit>()
        val finish = CompletableDeferred<Unit>()
        val wakes = AtomicInteger()
        val starts = AtomicInteger()
        val cancellations = AtomicInteger()
        val cancelled = AtomicBoolean()
        override suspend fun enqueue(account: String, peer: String, message: Int): String {
            starts.incrementAndGet()
            started.complete(Unit)
            try { finish.await() } finally {
                if (!finish.isCompleted) { cancelled.set(true); cancellations.incrementAndGet() }
            }
            return "fixture-action-test"
        }
        override fun list(account: String): List<NativeCloudDownload> = emptyList()
        override fun control(account: String, operation: String, action: String) = Unit
        override fun wake(context: Context): Boolean { wakes.incrementAndGet(); return true }
    }
}
