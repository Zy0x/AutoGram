package com.autogram.app.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import com.autogram.app.MainActivity
import com.autogram.app.R
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue

/** Exercise the actual activity and physical touch dispatch, not isolated screen content. */
class RootNavigationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun text(id: Int) = compose.activity.getString(id)
    private fun primary(id: Int) = compose.onNode(hasText(text(id)) and hasClickAction()
        and !hasAnyAncestor(hasScrollAction()))

    /** Safe aggregate phase diagnostics: no media content, filename or account value in output. */
    @Test fun authorizedCloudPhotoRangeDiagnostic() {
        compose.waitUntil(timeoutMillis = 20_000) {
            compose.onAllNodes(hasText(text(R.string.nav_drive)) and hasClickAction()
                and !hasAnyAncestor(hasScrollAction())).fetchSemanticsNodes().size == 1
        }
        kotlinx.coroutines.runBlocking(kotlinx.coroutines.Dispatchers.IO) {
            val account = uniffi.autogram_android_bridge.listAuthorizedAccounts().first { it.active && it.verified }
            val page = uniffi.autogram_android_bridge.listCloudMedia(account.id, "me", 0, "")
            val photo = page.items.first { it.mimeType.startsWith("image/") && it.size in 1uL..(1024uL * 1024uL) }
            var source: com.autogram.app.features.cloud.preview.CloudRangeSource? = null
            fun phase(value: String) = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
                .sendStatus(0, android.os.Bundle().apply { putString("stream", "cloud-photo-phase=$value\n") })
            try {
                phase("opening")
                source = com.autogram.app.features.cloud.preview.CloudRangeSource.open(account.id, "me", photo.id)
                phase("reading")
                val bytes = source.read(0, minOf(source.size, 4096).toInt())
                assertTrue("No real cloud bytes returned", bytes.isNotEmpty())
                phase("bytes-confirmed")
            } finally { source?.close() }
        }
    }

    /** Existing session + real Saved Messages photo. Read-only, never logs titles or bytes. */
    @Test fun authorizedDrivePhotoDecodesAndReturnsToGallery() {
        compose.waitUntil(timeoutMillis = 20_000) {
            compose.onAllNodes(hasText(text(R.string.nav_drive)) and hasClickAction()
                and !hasAnyAncestor(hasScrollAction())).fetchSemanticsNodes().size == 1
        }
        primary(R.string.nav_drive).performTouchInput { click() }
        compose.waitUntil(timeoutMillis = 20_000) {
            compose.onAllNodesWithTag("drive-media-image").fetchSemanticsNodes().isNotEmpty()
        }
        // Scroll by safe semantic tag; never print a user's filename or account identity.
        compose.onNodeWithTag("cloud-gallery").performScrollToNode(hasTestTag("drive-media-image"))
        compose.onAllNodesWithTag("drive-media-image").onFirst().performTouchInput { click() }
        try {
            compose.onNodeWithTag("drive-preview").assertIsDisplayed()
            try {
                compose.waitUntil(timeoutMillis = 35_000) {
                    compose.onAllNodesWithTag("preview-image-ready").fetchSemanticsNodes().isNotEmpty() ||
                        compose.onAllNodesWithTag("preview-error").fetchSemanticsNodes().isNotEmpty()
                }
            } catch (timeout: ComposeTimeoutException) {
                val phase = if (compose.onAllNodesWithTag("preview-reading").fetchSemanticsNodes().isNotEmpty()) "reading"
                    else if (compose.onAllNodesWithTag("preview-opening").fetchSemanticsNodes().isNotEmpty()) "opening" else "unknown"
                throw AssertionError("Photo preview timed out phase=$phase", timeout)
            }
            // Generic assertions only, avoiding a semantics dump containing personal filenames.
            assertTrue("Real photo did not decode", compose.onAllNodesWithTag("preview-image-ready").fetchSemanticsNodes().size == 1)
        } finally {
            compose.onNodeWithContentDescription(text(R.string.native_close)).performTouchInput { click() }
        }
        compose.onNodeWithTag("drive-preview").assertDoesNotExist()
        primary(R.string.nav_home).performTouchInput { click() }
    }

    /** Requires an already server-authorized user session. Never changes credentials or cloud data. */
    @Test fun authorizedDriveVideoStartsAndPauseControlWorks() {
        compose.waitUntil(timeoutMillis = 20_000) {
            compose.onAllNodes(hasText(text(R.string.nav_drive)) and hasClickAction()
                and !hasAnyAncestor(hasScrollAction())).fetchSemanticsNodes().size == 1
        }
        primary(R.string.nav_drive).performTouchInput { click() }
        compose.waitUntil(timeoutMillis = 20_000) {
            compose.onAllNodesWithTag("drive-media-image").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithTag("drive-media-video").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("cloud-gallery").performScrollToNode(hasTestTag("drive-media-video"))
        compose.onAllNodesWithTag("drive-media-video").onFirst().performTouchInput { click() }
        try {
            compose.waitUntil(timeoutMillis = 30_000) {
                compose.onAllNodes(hasContentDescription(text(R.string.cloud_preview_pause)) and hasClickAction())
                    .fetchSemanticsNodes().isNotEmpty() &&
                    compose.onAllNodesWithTag("preview-video-ready").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithContentDescription(text(R.string.cloud_preview_pause)).performTouchInput { click() }
            compose.waitUntil(timeoutMillis = 5_000) {
                compose.onAllNodes(hasContentDescription(text(R.string.cloud_preview_play)) and hasClickAction())
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("preview-seek").assertIsDisplayed()
        } finally {
            compose.onNodeWithContentDescription(text(R.string.native_close)).performTouchInput { click() }
        }
        compose.onNodeWithTag("drive-preview").assertDoesNotExist()
        primary(R.string.nav_home).performTouchInput { click() }
    }

    /** Requires an already server-authorized user session. Never changes credentials or cloud data. */
    @Test fun authenticatedGalleryRemainsReachableAndDockIsBounded() {
        // Cold start revalidates the saved account asynchronously. Do not bypass the gate.
        compose.waitUntil(timeoutMillis = 20_000) {
            compose.onAllNodes(hasText(text(R.string.nav_drive)) and hasClickAction()
                and !hasAnyAncestor(hasScrollAction())).fetchSemanticsNodes().size == 1
        }
        primary(R.string.nav_drive).performTouchInput { click() }
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("drive-stories").fetchSemanticsNodes().isNotEmpty() &&
                compose.onNodeWithTag("drive-stories").isDisplayed()
        }
        compose.onNodeWithTag("drive-stories").assertIsDisplayed()
        compose.onNode(hasSetTextAction()).assertIsDisplayed()
        val bounds = primary(R.string.nav_drive).getUnclippedBoundsInRoot()
        assertTrue("Navigation must remain bounded", bounds.bottom - bounds.top <= 112.dp)
        primary(R.string.nav_drive).assertHeightIsAtLeast(48.dp)
        compose.onNodeWithContentDescription(text(R.string.drive_toggle_view_accessibility)).performClick()
        primary(R.string.nav_home).performTouchInput { click() }
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithText(text(R.string.ui2_open_drive_action)).fetchSemanticsNodes().isNotEmpty() &&
                compose.onNodeWithText(text(R.string.ui2_open_drive_action)).isDisplayed()
        }
        compose.onNodeWithText(text(R.string.ui2_open_drive_action)).assertIsDisplayed()
        primary(R.string.nav_settings).performTouchInput { click() }
        val settingsTitle = hasText(text(R.string.ui2_settings_title)) and hasAnyAncestor(hasScrollAction())
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodes(settingsTitle).fetchSemanticsNodes().size == 1 &&
                compose.onNode(settingsTitle).isDisplayed()
        }
        compose.onNode(hasScrollAction()).performScrollToNode(hasText(text(R.string.ui2_free_space)))
        compose.onNodeWithText(text(R.string.ui2_free_space)).assertIsDisplayed()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText(text(R.string.real_unknown)).fetchSemanticsNodes().isEmpty()
        }
        primary(R.string.nav_home).performTouchInput { click() }
    }

    @Test fun bottomNavigationNeverExpandsOverThePage() {
        val bounds = primary(R.string.nav_home).getUnclippedBoundsInRoot()
        assertTrue("Navigation must not cover page content", bounds.bottom - bounds.top <= 112.dp)
        primary(R.string.nav_home).assertHeightIsAtLeast(48.dp)
        compose.onNodeWithText(text(R.string.home_action_open_remote)).performTouchInput { click() }
        compose.onNodeWithText(text(R.string.remote_input_label)).assertIsDisplayed()
    }

    @Test fun primaryRoutesAndAccountFormAreReachableByTouch() {
        primary(R.string.nav_transfer).performTouchInput { click() }
        compose.onNodeWithText(text(R.string.real_queue_scope)).assertIsDisplayed()
        primary(R.string.nav_settings).performTouchInput { click() }
        compose.onNodeWithText(text(R.string.real_settings_title)).assertIsDisplayed()
        primary(R.string.nav_tools).performTouchInput { click() }
        compose.onNode(hasScrollAction()).performScrollToNode(hasText(text(R.string.nav_accounts)))
        // Scroll the card clear of the floating dock before dispatching a real tap.
        compose.onNode(hasScrollAction()).performTouchInput {
            swipeUp(startY = height * 0.5f, endY = height * 0.25f)
        }
        compose.onNode(hasText(text(R.string.nav_accounts)) and hasClickAction()
            and hasAnyAncestor(hasScrollAction())).performTouchInput { click() }
        compose.onNodeWithText(text(R.string.auth_title)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.auth_api_instructions)).assertIsDisplayed()
    }
}
