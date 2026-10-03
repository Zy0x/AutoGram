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
