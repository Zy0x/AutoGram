package com.autogram.app.ui

import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.R
import com.autogram.app.features.cloud.*
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.ui.drive.DriveScreenContent
import com.autogram.app.ui.drive.gallery.DriveStories
import com.autogram.app.viewmodel.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Isolated presentation fixtures: never replace credentials, invoke Telegram or change app records. */
class GalleryRedesignTest {
    @get:Rule val compose = createComposeRule()
    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)
    private val locations = CloudState(scope = CloudScope("fixture", "one"),
        locations = listOf(CloudLocation("one", "Fixture One", "channel"), CloudLocation("two", "Fixture Two", "channel")))

    @Test fun storyScopesHaveRealTouchTargetsAndSelectedState() {
        var chosen = ""
        compose.setContent { AutoGramTheme { DriveStories(locations, {}, { chosen = it.id }) } }
        compose.onNode(hasText("Fixture One") and hasClickAction()).assertIsSelected().assertWidthIsAtLeast(64.dp)
        compose.onNode(hasText("Fixture Two") and hasClickAction()).performTouchInput { click() }
        compose.runOnIdle { assertEquals("two", chosen) }
    }

    @Test fun compactLargeTextGalleryScrollsAndLongPressSelectsSquareTile() {
        val records = (1..12).map { DriveFileItem("$it", "fixture-$it", 20, "image/jpeg", false,
            172800000, telegramCategory = "photo") }
        var selected by mutableStateOf(emptySet<String>())
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1.4f)) {
                AutoGramTheme { gallery(DriveUiState(items = records, selectedIds = selected),
                    onLong = { selected = setOf(it.id) }) }
            }
        }
        compose.onNodeWithTag("cloud-gallery").performScrollToNode(hasContentDescription("fixture-1"))
        val bounds = compose.onNodeWithContentDescription("fixture-1").getUnclippedBoundsInRoot()
        assertTrue(kotlin.math.abs((bounds.right - bounds.left).value - (bounds.bottom - bounds.top).value) < 1f)
        compose.onNodeWithContentDescription("fixture-1").performTouchInput { longClick() }
        compose.onNodeWithContentDescription("fixture-1").assertIsSelected()
        compose.onNodeWithTag("cloud-gallery").performScrollToNode(hasContentDescription("fixture-12"))
        compose.onNodeWithContentDescription("fixture-12").assertIsDisplayed()
    }

    @Test fun railAppearsAboveSearchAndErrorsRemainRetryable() {
        var refreshed = false
        compose.setContent { AutoGramTheme { gallery(DriveUiState(errorCode = "cloud_read_failed"),
            onRefresh = { refreshed = true }) } }
        val stories = compose.onNodeWithTag("drive-stories").getUnclippedBoundsInRoot()
        val search = compose.onNode(hasSetTextAction()).getUnclippedBoundsInRoot()
        assertTrue(stories.top < search.top)
        compose.onNodeWithTag("cloud-gallery").performScrollToNode(hasText(text(R.string.cloud_read_failed)))
        compose.onNodeWithText(text(R.string.drive_action_refresh)).performClick()
        compose.runOnIdle { assertTrue(refreshed) }
    }

    @Composable private fun gallery(state: DriveUiState, onLong: (DriveFileItem) -> Unit = {}, onRefresh: () -> Unit = {}) {
        DriveScreenContent(state = state, modifier = Modifier.width(320.dp),
            onSearchChange = {}, onMediaFilterChange = {}, onToggleViewMode = {}, onRefresh = onRefresh,
            onUpload = {}, onClearSelection = {}, onSelectAll = {}, onInvertSelection = {},
            onDownloadZip = {}, onCleanForward = {}, onMoveFolder = {}, onCopyLinks = {}, onTagCategory = {},
            onDeleteSelected = {}, onOpenTools = {}, onItemClick = {}, onItemLongClick = onLong,
            storyControls = { DriveStories(locations, {}, {}) })
    }
}
