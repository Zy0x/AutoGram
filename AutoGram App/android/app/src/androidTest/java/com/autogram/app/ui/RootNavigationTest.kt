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
