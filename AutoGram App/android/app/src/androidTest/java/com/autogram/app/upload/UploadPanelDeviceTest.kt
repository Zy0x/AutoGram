package com.autogram.app.upload

import android.content.Context
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.R
import com.autogram.app.features.cloud.CloudScope
import com.autogram.app.features.cloudtransfer.upload.UploadPanel
import com.autogram.app.features.cloudtransfer.upload.UploadQueue
import com.autogram.app.theme.AutoGramTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import uniffi.autogram_android_bridge.*
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** Isolated queue only; no native auth, Telegram, private sources or production metadata. */
class UploadPanelDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CloudScope("tg_123", "-1000000000456", 17)
    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)
    private fun awaitPanel() {
        compose.waitUntil(5_000) {
            try { compose.onAllNodesWithTag("cloud-upload-panel").fetchSemanticsNodes().isNotEmpty() }
            catch (failure: IllegalStateException) {
                if (failure.message?.contains("No compose hierarchies") == true) false else throw failure
            }
        }
    }

    @Test fun openingQueueOnlyReadsActualRecordsAndCannotWakeOrEnqueue() {
        val queue = FixtureQueue()
        compose.setContent { AutoGramTheme { UploadPanel(scope, "fixture destination", {}, queue) } }
        awaitPanel()
        compose.waitUntil(5_000) { queue.reads.get() > 0 }
        compose.onNodeWithText("fixture.bin").assertIsDisplayed()
        assertEquals(0, queue.wakes.get()); assertEquals(0, queue.enqueues.get())
    }
    @Test fun resumeCarriesOriginalAccountAndOperationAndReportsDeferredStart() {
        val queue = FixtureQueue()
        compose.setContent { AutoGramTheme { UploadPanel(scope, "fixture destination", {}, queue) } }
        awaitPanel()
        compose.waitUntil(5_000) { queue.reads.get() > 0 }
        compose.onNodeWithText(text(R.string.cloud_download_resume)).performClick()
        compose.waitUntil(5_000) { queue.wakes.get() == 1 }
        assertEquals(listOf("tg_123", "fixture-operation", "retry"), queue.controls.single())
        compose.onNodeWithText(text(R.string.cloud_upload_waiting)).assertIsDisplayed()
    }
    @Test fun foreignAccountPeerAndTopicRecordsNeverBecomeControls() {
        val queue = FixtureQueue(foreign = true)
        compose.setContent { AutoGramTheme { UploadPanel(scope, "fixture destination", {}, queue) } }
        awaitPanel()
        compose.waitUntil(5_000) { queue.reads.get() > 0 }
        compose.onNodeWithText("fixture.bin").assertDoesNotExist()
        compose.onNodeWithText(text(R.string.cloud_upload_empty)).assertIsDisplayed()
        assertTrue(queue.controls.isEmpty())
    }
    @Test fun interruptedCommitOffersReadOnlyConfirmationAndNoResendControl() {
        val queue = FixtureQueue(state = "review_required")
        compose.setContent { AutoGramTheme { UploadPanel(scope, "fixture destination", {}, queue) } }
        awaitPanel()
        compose.waitUntil(5_000) { queue.reads.get() > 0 }
        compose.onNodeWithText(text(R.string.cloud_download_resume)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.cloud_upload_check_receipt)).performClick()
        compose.waitUntil(5_000) { queue.reconciled.isNotEmpty() }
        assertEquals(listOf("tg_123", "fixture-operation"), queue.reconciled.single())
        assertEquals(0, queue.wakes.get()); assertEquals(0, queue.enqueues.get())
    }
    @Test fun forumWithoutAnExplicitTopicCannotChooseAnUploadSource() {
        val queue = FixtureQueue()
        compose.setContent { AutoGramTheme { UploadPanel(scope.copy(topicId = null),
            "fixture destination", {}, queue, allowSelection = false) } }
        awaitPanel()
        compose.onNodeWithTag("cloud-upload-choose").assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.cloud_upload_choose_topic)).assertIsDisplayed()
        assertEquals(0, queue.enqueues.get())
    }
    @Test fun navigationDisposesTheOldScopedQueueAndItsControls() {
        val queue = FixtureQueue()
        var current by mutableStateOf(scope)
        compose.setContent { AutoGramTheme { UploadPanel(current, "fixture destination", {}, queue) } }
        awaitPanel()
        compose.waitUntil(5_000) { queue.reads.get() > 0 }
        compose.onNodeWithText("fixture.bin").assertIsDisplayed()
        compose.runOnIdle { current = scope.copy(topicId = 18) }
        compose.waitUntil(5_000) { compose.onAllNodesWithText(text(R.string.cloud_upload_empty)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("fixture.bin").assertDoesNotExist()
        assertTrue(queue.controls.isEmpty()); assertEquals(0, queue.wakes.get())
    }
    private class FixtureQueue(val foreign: Boolean = false, val state: String = "paused") : UploadQueue {
        val reads = AtomicInteger(); val wakes = AtomicInteger(); val enqueues = AtomicInteger()
        val controls = CopyOnWriteArrayList<List<String>>()
        val reconciled = CopyOnWriteArrayList<List<String>>()
        override suspend fun enqueue(input: NativeUploadInput): NativeUploadAdmission {
            enqueues.incrementAndGet(); error("No fixture sends")
        }
        override fun list(account: String): List<NativeCloudUpload> {
            reads.incrementAndGet()
            val record = NativeCloudUpload("fixture-operation", "tg_123", "-1000000000456", 17,
                "fixture.bin", state, 100uL, 17uL, null, null, null, null)
            return if (!foreign) listOf(record) else listOf(record.copy(accountId = "tg_999"),
                record.copy(peerId = "-1000000000789"), record.copy(topicId = 18))
        }
        override fun control(account: String, operation: String, action: String) { controls.add(listOf(account, operation, action)) }
        override suspend fun reconcile(account: String, operation: String) { reconciled.add(listOf(account, operation)) }
        override fun schedule(context: Context) = error("Reading fixtures never schedules")
        override fun wake(context: Context): Boolean { wakes.incrementAndGet(); return false }
    }
}
