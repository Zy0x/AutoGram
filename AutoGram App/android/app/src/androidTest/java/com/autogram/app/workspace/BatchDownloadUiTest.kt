package com.autogram.app.workspace

import android.content.Context
import android.os.Looper
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.autogram.app.features.cloud.CloudScope
import com.autogram.app.features.cloudtransfer.hooks.rememberBatchDownloadAction
import com.autogram.app.features.cloudtransfer.DownloadPresentationWriter
import com.autogram.app.features.cloudtransfer.services.DownloadQueue
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.viewmodel.DriveFileItem
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import uniffi.autogram_android_bridge.NativeCloudDownload
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/** Fake enqueue and worker only: no native account, Telegram, output URI or personal files. */
class BatchDownloadUiTest {
    @get:Rule val compose = createComposeRule()
    private val original = CloudScope("batch-fixture-account", "batch-fixture-peer", 17)
    private fun selected(scope: CloudScope = original) = (1..2).map { id ->
        DriveFileItem(id.toString(), "batch-fixture-$id", 10, "text/plain", false, 0,
            cloudAccountId = scope.accountId, cloudPeerId = scope.peerId,
            cloudMessageId = id, topicId = scope.topicId)
    }
    @Composable private fun Harness(scope: CloudScope, queue: DownloadQueue, cleared: (Set<String>) -> Unit) {
        val action = rememberBatchDownloadAction(scope, cleared, queue,
            DownloadPresentationWriter { _, _, _, _ -> })
        AutoGramTheme { Button(onClick = { action(selected(scope)) }, modifier = Modifier.testTag("fixture-batch")) {
            Text("fixture")
        } }
    }
    @Test fun topicScopeReachesTheAdapterAndOnlyAcknowledgedBatchClearsSelection() {
        val queue = FixtureQueue()
        val cleared = CopyOnWriteArrayList<Set<String>>()
        compose.setContent { Harness(original, queue) {
            assertSame(Looper.getMainLooper(), Looper.myLooper())
            cleared.add(it)
        } }
        compose.onNodeWithTag("fixture-batch").performClick()
        compose.waitUntil(5_000) { cleared.isNotEmpty() }
        assertEquals(setOf("1", "2"), cleared.single())
        assertEquals(1, queue.wakes.get())
        assertEquals(listOf("batch-fixture-account", "batch-fixture-peer", "17", "1"), queue.calls.first())
    }
    @Test fun partialFailureRetainsSelectionAndWakesOnlyTheAcknowledgedWork() {
        val queue = FixtureQueue(failMessage = 2)
        val cleared = CopyOnWriteArrayList<Set<String>>()
        compose.setContent { Harness(original, queue) { cleared.add(it) } }
        compose.onNodeWithTag("fixture-batch").performClick()
        compose.waitUntil(5_000) { queue.wakes.get() == 1 }
        compose.waitForIdle()
        assertTrue(cleared.isEmpty()); assertEquals(2, queue.calls.size)
    }
    @Test fun totalFailureCannotWakeWorkOrClearSelection() {
        val queue = FixtureQueue(failMessage = -1)
        val cleared = CopyOnWriteArrayList<Set<String>>()
        compose.setContent { Harness(original, queue) { cleared.add(it) } }
        compose.onNodeWithTag("fixture-batch").performClick()
        compose.waitUntil(5_000) { queue.calls.size == 2 }
        compose.waitForIdle()
        assertTrue(cleared.isEmpty()); assertEquals(0, queue.wakes.get())
    }
    @Test fun changingScopeCancelsAnInFlightBatchAndDoesNotWakeOrClearTheNewAccount() {
        val queue = FixtureQueue(waiting = CompletableDeferred())
        var scope by mutableStateOf(original)
        val cleared = CopyOnWriteArrayList<Set<String>>()
        compose.setContent { Harness(scope, queue) { cleared.add(it) } }
        compose.onNodeWithTag("fixture-batch").performClick()
        compose.waitUntil(5_000) { queue.calls.isNotEmpty() }
        compose.runOnIdle { scope = original.copy(accountId = "batch-fixture-other") }
        compose.waitForIdle()
        queue.waiting!!.complete("fixture-op")
        compose.waitForIdle()
        assertEquals(1, queue.calls.size); assertEquals(0, queue.wakes.get()); assertTrue(cleared.isEmpty())
    }
    private class FixtureQueue(val failMessage: Int = 0, val waiting: CompletableDeferred<String>? = null) : DownloadQueue {
        val calls = CopyOnWriteArrayList<List<String>>()
        val wakes = AtomicInteger()
        override suspend fun enqueue(account: String, peer: String, message: Int): String = error("scope required")
        override suspend fun enqueueScoped(account: String, peer: String, topic: Long?, message: Int): String {
            calls.add(listOf(account, peer, topic.toString(), message.toString()))
            if (failMessage == -1 || message == failMessage) error("fixture-enqueue-rejected")
            return waiting?.await() ?: "fixture-op-$message"
        }
        override fun list(account: String): List<NativeCloudDownload> = error("batch does not list")
        override fun control(account: String, operation: String, action: String) = error("batch does not control")
        override fun wake(context: Context): Boolean {
            assertSame(Looper.getMainLooper(), Looper.myLooper())
            wakes.incrementAndGet()
            return true
        }
    }
}
