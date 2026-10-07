package com.autogram.app.ui

import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.R
import com.autogram.app.features.cloud.*
import com.autogram.app.features.cloud.topics.CloudTopic
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.ui.drive.DriveScreenContent
import com.autogram.app.ui.drive.gallery.DriveStories
import com.autogram.app.viewmodel.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Presentation-only fixtures. No credentials, Telegram writes or production worker changes. */
class DrivePinnedNavigationTest {
    @get:Rule val compose = createComposeRule()
    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)
    private val locations = CloudState(scope = CloudScope("fixture", "forum"), locations = listOf(
        CloudLocation("forum", "Fixture forum", "forum"), CloudLocation("other", "Other drive", "channel")))
    private val records = (1..90).map { DriveFileItem("$it", "fixture-$it", 20,
        "image/jpeg", false, 172800000, telegramCategory = "photo") }
    private val state = DriveUiState(sessionId = "fixture", peerId = "forum", isForum = true,
        activeLocationTitle = "Fixture forum", topics = listOf(CloudTopic(7, "Server topic")), items = records)

    @Test fun scrollPinsCompactDriveAndTopicsAndTapUsesServerIdentity() {
        var chosen: Long? = null
        var hub = false
        compose.setContent { AutoGramTheme { gallery(state, onTopic = { chosen = it }, onHub = { hub = true }) } }
        compose.onNodeWithTag("drive-navigation-expanded").assertExists()
        compose.onNodeWithTag("cloud-gallery").performScrollToNode(hasContentDescription("fixture-60"))
        compose.onNodeWithTag("drive-navigation-compact").assertIsDisplayed()
        compose.onNodeWithTag("drive-stories").assertIsDisplayed()
        compose.onNodeWithTag("drive-topic:7").assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
        compose.runOnIdle { assertEquals(7L, chosen) }
        compose.onNodeWithTag("drive-topic-picker").performClick()
        compose.runOnIdle { assertTrue(hub) }
        val nav = compose.onNodeWithTag("drive-navigation-compact").getUnclippedBoundsInRoot()
        val grid = compose.onNodeWithTag("cloud-gallery").getUnclippedBoundsInRoot()
        assertTrue(nav.bottom <= grid.top)
        compose.onNodeWithTag("cloud-gallery").performScrollToIndex(0)
        compose.onNodeWithTag("drive-navigation-expanded").assertIsDisplayed()
    }

    @Test fun topicFailureDoesNotHidePickerOrRetry() {
        var retry = false
        compose.setContent { AutoGramTheme { gallery(state.copy(topics = emptyList()),
            error = "cloud_request_failed", onRetry = { retry = true }) } }
        compose.onNodeWithTag("drive-topic-picker").assertIsDisplayed()
        compose.onNodeWithText(text(R.string.cloud_refresh)).performClick()
        compose.runOnIdle { assertTrue(retry) }
    }

    @Test fun topicSelectedFromPickerRemainsVisibleInLongRail() {
        var active by mutableStateOf<Long?>(null)
        val topics = (1L..30L).map { CloudTopic(it, "Fixture topic $it") }
        compose.setContent { AutoGramTheme { gallery(state.copy(topics = topics, activeTopicId = active)) } }
        compose.runOnIdle { active = 30 }
        compose.onNodeWithTag("drive-topic:30").assertIsDisplayed().assertIsSelected()
    }

    @Test fun focusedSearchSurvivesCompactingAndTopicSelectionIsAccessible() {
        var query by mutableStateOf("")
        compose.setContent { AutoGramTheme { gallery(state.copy(searchQuery = query, activeTopicId = 7),
            onQuery = { query = it }) } }
        // Scoped media fixtures must belong to this actual selected topic.
        compose.onNodeWithTag("drive-topic:7").assertIsSelected()
        compose.onNodeWithTag("drive-search").performClick().performTextInput("fixture")
        compose.onNodeWithTag("cloud-gallery").performScrollToIndex(1)
        compose.onNodeWithTag("drive-search").assertIsDisplayed().assertTextContains("fixture")
    }

    @Composable private fun gallery(state: DriveUiState, onTopic: (Long?) -> Unit = {},
        onHub: () -> Unit = {}, error: String? = null, onRetry: () -> Unit = {}, onQuery: (String) -> Unit = {}) {
        DriveScreenContent(state = state.copy(items = state.items.map { it.copy(topicId = state.activeTopicId) }),
            modifier = Modifier.width(320.dp), onSearchChange = onQuery, onMediaFilterChange = {},
            onTopicSelect = onTopic, onOpenTopicHub = onHub, topicsError = error, onRetryTopics = onRetry,
            onToggleViewMode = {}, onRefresh = {}, onUpload = {}, onClearSelection = {},
            onSelectAll = {}, onInvertSelection = {}, onDownloadZip = {}, onCleanForward = {},
            onMoveFolder = {}, onCopyLinks = {}, onTagCategory = {}, onDeleteSelected = {},
            onOpenTools = {}, onItemClick = {}, onItemLongClick = {},
            storyControls = { compact -> DriveStories(locations, {}, {}, compact = compact) })
    }
}
