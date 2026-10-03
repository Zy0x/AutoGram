package com.autogram.app.cloud

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.features.cloud.*
import com.autogram.app.theme.AutoGramTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class CloudControlsTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private fun text(id: Int) = compose.activity.getString(id)

    @Test fun unverifiedScopeCannotRequestDialogs() {
        var requests = 0
        compose.setContent { AutoGramTheme {
            CloudControls(CloudState(), { requests++ }, {}, {})
        } }
        compose.onNodeWithText(text(R.string.cloud_choose_location)).assertIsNotEnabled()
        assertEquals(0, requests)
    }

    @Test fun actualLocationButtonRequestsFreshListAndPublishesChosenPeer() {
        var refresh: Boolean? = null
        var selected: CloudLocation? = null
        val location = CloudLocation("123", "Test-only peer", "user")
        compose.setContent { AutoGramTheme {
            androidx.compose.foundation.layout.Box(Modifier.width(360.dp)) {
                CloudControls(CloudState(scope = CloudScope("A"), locations = listOf(location)),
                    { refresh = it }, { selected = it }, {})
            }
        } }
        compose.onNodeWithText(text(R.string.cloud_choose_location)).performClick()
        compose.onNodeWithText(location.title).assertIsDisplayed().performClick()
        assertEquals(false, refresh)
        assertEquals(location, selected)
        compose.onNodeWithText(location.title).assertDoesNotExist()
    }

    @Test fun savedMessagesAndMediaContinuationAreSeparateActions() {
        var selected: CloudLocation? = null
        var more = 0
        compose.setContent { AutoGramTheme {
            CloudControls(CloudState(scope = CloudScope("A"), nextOffset = 100), {}, { selected = it }, { more++ })
        } }
        compose.onNodeWithText(text(R.string.cloud_more)).performClick()
        assertEquals(1, more)
        compose.onNodeWithText(text(R.string.cloud_choose_location)).performClick()
        compose.onNodeWithText(text(R.string.cloud_saved_messages)).performClick()
        assertEquals("me", selected?.id)
        assertEquals(1, more)
    }
}
