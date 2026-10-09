package com.autogram.app.workspace

import android.content.Context
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.R
import com.autogram.app.features.cloudtransfer.services.DownloadQueue
import com.autogram.app.features.workspace.execution.ExecutionBoundaryScreen
import com.autogram.app.features.workspace.execution.PendingExecutionDomain
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.ui.jobs.JobsScreen
import com.autogram.app.ui.jobs.JobsScreenContent
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import uniffi.autogram_android_bridge.NativeCloudDownload
import uniffi.autogram_android_bridge.NativeDownloadException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean

/** Isolated queue only: never uses native accounts, workers, cloud or session settings. */
class ExecutionBoundaryUiTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun allPendingDomainsHaveAnHonestBoundaryAndNoDispatchButton() {
        var domain by mutableStateOf(PendingExecutionDomain.FORWARDER)
        compose.setContent { AutoGramTheme { ExecutionBoundaryScreen(domain) } }
        PendingExecutionDomain.entries.forEach { value ->
            compose.runOnIdle { domain = value }
            compose.onNodeWithTag("execution-boundary:${value.name}").assertIsDisplayed()
            compose.onNodeWithText(context.getString(value.title)).assertIsDisplayed()
            compose.onAllNodes(hasClickAction()).assertCountEquals(0)
        }
    }

    @Test fun largeFontStillAllowsReadingTheBoundary() {
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                AutoGramTheme { ExecutionBoundaryScreen(PendingExecutionDomain.SYNC) }
            }
        }
        compose.onNodeWithTag("execution-boundary:SYNC").assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.execution_no_simulated_records))
            .performScrollTo().assertIsDisplayed()
    }

    @Test fun nativeQueueRequiresAnAccountAndAnExplicitAccessibleAction() {
        var accountAvailable by mutableStateOf(false)
        var opened = 0
        compose.setContent { AutoGramTheme {
            JobsScreenContent(accountAvailable, { opened++ })
        } }
        compose.onNodeWithTag("jobs-native-downloads").assertIsNotEnabled()
        compose.runOnIdle { assertEquals(0, opened); accountAvailable = true }
        compose.onNodeWithTag("jobs-native-downloads").assertIsEnabled()
            .assertHeightIsAtLeast(48.dp).performTouchInput { click() }
        compose.runOnIdle { assertEquals(1, opened) }
    }

    @Test fun visitingJobsDoesNotListEnqueueOrWakeWork() {
        val queue = IsolatedQueue()
        compose.setContent { AutoGramTheme { JobsScreen(accountId = "fixture-a", queue = queue) } }
        compose.waitForIdle()
        assertEquals(0, queue.listCalls.get())
        assertEquals(0, queue.enqueued.get())
        assertEquals(0, queue.woken.get())
        compose.onNodeWithTag("jobs-native-downloads").performTouchInput { click() }
        waitForText(context.getString(R.string.cloud_download_bytes, "17", "100"))
        compose.onNodeWithText(context.getString(R.string.cloud_download_bytes, "17", "100")).assertIsDisplayed()
        assertEquals(0, queue.enqueued.get())
        assertEquals(0, queue.woken.get())
    }

    @Test fun queueControlsCarryTheOriginalAccountAndOperation() {
        val queue = IsolatedQueue()
        compose.setContent { AutoGramTheme { JobsScreen(accountId = "fixture-a", queue = queue) } }
        compose.onNodeWithTag("jobs-native-downloads").performTouchInput { click() }
        waitForText(context.getString(R.string.cloud_download_bytes, "17", "100"))
        compose.onNodeWithText(context.getString(R.string.cloud_download_pause)).performClick()
        compose.waitUntil(5_000) { queue.controls.isNotEmpty() }
        assertEquals(listOf("fixture-a", "operation-fixture", "pause"), queue.controls.first())
        assertEquals(0, queue.woken.get())
    }

    @Test fun accountChangeClosesOldQueueWithoutDispatching() {
        val queue = IsolatedQueue()
        var account by mutableStateOf("fixture-a")
        compose.setContent { AutoGramTheme { JobsScreen(accountId = account, queue = queue) } }
        compose.onNodeWithTag("jobs-native-downloads").performTouchInput { click() }
        waitForText(context.getString(R.string.cloud_download_bytes, "17", "100"))
        compose.runOnIdle { account = "fixture-b" }
        compose.onNodeWithText(context.getString(R.string.cloud_download_bytes, "17", "100")).assertDoesNotExist()
        assertEquals(0, queue.enqueued.get())
        assertEquals(0, queue.woken.get())
    }

    @Test fun recoveredQueueReadingClearsItsPreviousError() {
        val queue = IsolatedQueue()
        queue.available.set(false)
        compose.setContent { AutoGramTheme { JobsScreen(accountId = "fixture-a", queue = queue) } }
        compose.onNodeWithTag("jobs-native-downloads").performClick()
        waitForText(context.getString(R.string.cloud_download_failed))
        compose.onNodeWithText(context.getString(R.string.cloud_download_failed)).assertIsDisplayed()
        queue.available.set(true)
        compose.waitUntil(5_000) {
            compose.onAllNodesWithText(context.getString(R.string.cloud_download_bytes, "17", "100"))
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(context.getString(R.string.cloud_download_failed)).assertDoesNotExist()
    }

    @Test fun rejectedWorkerStartDoesNotImplyResumedExecution() {
        val queue = IsolatedQueue(state = "paused")
        compose.setContent { AutoGramTheme { JobsScreen(accountId = "fixture-a", queue = queue) } }
        compose.onNodeWithTag("jobs-native-downloads").performClick()
        waitForText(context.getString(R.string.cloud_download_resume))
        compose.onNodeWithText(context.getString(R.string.cloud_download_resume)).performClick()
        compose.waitUntil(5_000) { queue.woken.get() == 1 }
        waitForText(context.getString(R.string.cloud_download_failed))
        compose.onNodeWithText(context.getString(R.string.cloud_download_failed)).assertIsDisplayed()
        assertEquals(listOf("fixture-a", "operation-fixture", "retry"), queue.controls.first())
    }

    @Test fun foreignAccountRecordsCannotBecomeQueueControls() {
        val queue = IsolatedQueue(foreignRecord = true)
        compose.setContent { AutoGramTheme { JobsScreen(accountId = "fixture-a", queue = queue) } }
        compose.onNodeWithTag("jobs-native-downloads").performClick()
        compose.waitUntil(5_000) { queue.listCalls.get() >= 2 }
        compose.onNodeWithText(context.getString(R.string.cloud_download_message, 999)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.cloud_download_empty)).assertIsDisplayed()
        compose.onAllNodesWithText(context.getString(R.string.cloud_download_pause)).assertCountEquals(0)
    }

    private fun waitForText(text: String) {
        compose.waitUntil(5_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }

    private class IsolatedQueue(private val state: String = "running", private val foreignRecord: Boolean = false) : DownloadQueue {
        val listCalls = AtomicInteger()
        val enqueued = AtomicInteger()
        val woken = AtomicInteger()
        val available = AtomicBoolean(true)
        val controls = CopyOnWriteArrayList<List<String>>()
        override suspend fun enqueue(account: String, peer: String, message: Int): String {
            enqueued.incrementAndGet()
            error("Tests never enqueue downloads")
        }
        override fun list(account: String): List<NativeCloudDownload> {
            listCalls.incrementAndGet()
            if (!available.get()) throw NativeDownloadException.RequestFailed("fixture-read-failed", 0uL)
            return listOf(NativeCloudDownload("operation-fixture", if (foreignRecord) "fixture-foreign" else account,
                if (foreignRecord) 999 else 101, state,
                100uL, 17uL, null, null, null, null))
        }
        override fun control(account: String, operation: String, action: String) {
            controls.add(listOf(account, operation, action))
        }
        override fun wake(context: Context): Boolean {
            woken.incrementAndGet()
            return false
        }
    }
}
