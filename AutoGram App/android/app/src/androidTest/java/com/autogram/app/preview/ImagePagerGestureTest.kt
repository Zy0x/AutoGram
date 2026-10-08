package com.autogram.app.preview

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.R
import com.autogram.app.features.cloud.preview.CloudImageViewer
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.ui.drive.DrivePreviewModal
import com.autogram.app.ui.keepUnlockedFixtureAwake
import com.autogram.app.viewmodel.DriveFileItem
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** Actual dialog/gesture controls, generated bitmap only; no Telegram/accounts or private media. */
@OptIn(ExperimentalTestApi::class)
class ImagePagerGestureTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Before fun unlocked() = keepUnlockedFixtureAwake { compose.activity }
    private val bitmap = Bitmap.createBitmap(800, 800, Bitmap.Config.ARGB_8888)
    private val records = (1..3).map { DriveFileItem("$it", "gesture-fixture-$it", 20, "image/png", false, 0) }
    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    @Test fun photoSwipesBothWaysAndZoomedPanDoesNotNavigate() {
        var selected by mutableStateOf(records.first())
        compose.setContent { AutoGramTheme {
            DrivePreviewModal(selected, records, {}, { selected = it }, previewContent = { row, paging ->
                CloudImageViewer(bitmap, row.name, paging)
            })
        } }
        compose.onNodeWithTag("preview-image-ready").performTouchInput { swipeLeft() }
        compose.waitUntil(5000) { selected.id == "2" }
        compose.onNodeWithTag("preview-image-ready").performTouchInput { swipeRight() }
        compose.waitUntil(5000) { selected.id == "1" }
        compose.onNodeWithTag("preview-image-ready").performTouchInput { doubleClick(center) }
        compose.onNodeWithTag("preview-image-ready").assert(SemanticsMatcher.expectValue(
            SemanticsProperties.StateDescription, InstrumentationRegistry.getInstrumentation().targetContext.getString(R.string.preview_image_zoom_value, 250)))
        compose.onNodeWithTag("preview-image-ready").performTouchInput { swipeLeft() }
        compose.runOnIdle { assertEquals("1", selected.id) }
        compose.onNodeWithTag("preview-image-tools").performScrollToNode(hasContentDescription(text(R.string.cloud_preview_reset_zoom)))
        compose.onNodeWithTag("preview-image-reset").performClick()
        compose.onNodeWithTag("preview-image-ready").performTouchInput { swipeLeft() }
        compose.waitUntil(5000) { selected.id == "2" }
    }

    @Test fun onlySettledPageOwnsAViewerAndExternalSelectionIsRespected() {
        var selected by mutableStateOf(records.first())
        var items by mutableStateOf(records)
        val owners = mutableSetOf<String>()
        var maxOwners = 0
        compose.setContent { AutoGramTheme {
            DrivePreviewModal(selected, items, {}, { selected = it }, previewContent = { row, paging ->
                DisposableEffect(row.id) {
                    owners.add(row.id); maxOwners = maxOf(maxOwners, owners.size)
                    onDispose { owners.remove(row.id) }
                }
                CloudImageViewer(bitmap, row.name, paging)
            })
        } }
        compose.onNodeWithTag("preview-next").performClick()
        compose.waitUntil(5000) { selected.id == "2" }
        compose.runOnIdle { assertEquals(setOf("2"), owners); assertEquals(1, maxOwners); selected = records.last() }
        compose.waitUntil(5000) { owners == setOf("3") }
        compose.runOnIdle { items = records.reversed() }
        compose.waitUntil(5000) { owners == setOf("3") }
        compose.waitUntil(5000) {
            owners == setOf("3") && compose.onNodeWithText("gesture-fixture-3").isDisplayed() &&
                compose.onNodeWithTag("preview-previous").fetchSemanticsNode().config.contains(SemanticsProperties.Disabled)
        }
        compose.onNodeWithText("gesture-fixture-3").assertIsDisplayed()
        compose.onNodeWithTag("preview-previous").assertIsNotEnabled()
        compose.runOnIdle { assertEquals(1, maxOwners) }
    }

    @Test fun transformsExposeAccessibleActionsAnd48DpControls() {
        compose.setContent { AutoGramTheme { CloudImageViewer(bitmap, "gesture-fixture") } }
        val image = compose.onNodeWithTag("preview-image-ready")
        image.assert(SemanticsMatcher.keyIsDefined(SemanticsActions.CustomActions))
        compose.onNodeWithContentDescription(text(R.string.preview_rotate_cw)).assertHeightIsAtLeast(androidx.compose.ui.unit.Dp(48f)).performClick()
        compose.onNodeWithTag("preview-image-tools").performScrollToNode(hasContentDescription(text(R.string.preview_flip_h)))
        compose.onNodeWithContentDescription(text(R.string.preview_flip_h)).performClick().assertIsOn()
    }

    @Test fun twoFingerPinchAndAccessibleResetKeepTheSelectedPhoto() {
        var selected by mutableStateOf(records.first())
        var paging = true
        compose.setContent { AutoGramTheme {
            DrivePreviewModal(selected, records, {}, { selected = it }, previewContent = { row, callback ->
                CloudImageViewer(bitmap, row.name) { enabled -> paging = enabled; callback(enabled) }
            })
        } }
        val image = compose.onNodeWithTag("preview-image-ready")
        image.performTouchInput {
            pinch(start0 = center - Offset(60f, 0f), end0 = center - Offset(180f, 0f),
                start1 = center + Offset(60f, 0f), end1 = center + Offset(180f, 0f))
        }
        compose.runOnIdle { assertFalse(paging); assertEquals("1", selected.id) }
        val resetAction = image.fetchSemanticsNode().config[SemanticsActions.CustomActions]
            .single { it.label == text(R.string.cloud_preview_reset_zoom) }
        compose.runOnIdle { assertTrue(resetAction.action()) }
        compose.runOnIdle { assertTrue(paging); assertEquals("1", selected.id) }
        image.performTouchInput { swipeLeft() }
        compose.waitUntil(5000) { selected.id == "2" }
    }

    @Test fun keyboardArrowsNavigateAndEscapeClosesTheDialog() {
        var selected by mutableStateOf(records.first())
        var visible by mutableStateOf(true)
        compose.setContent { AutoGramTheme {
            if (visible) DrivePreviewModal(selected, records, { visible = false }, { selected = it },
                previewContent = { row, paging -> CloudImageViewer(bitmap, row.name, paging) })
        } }
        val dialog = compose.onNodeWithTag("drive-preview")
        dialog.performSemanticsAction(SemanticsActions.RequestFocus) { it() }
        dialog.performKeyInput { keyDown(Key.DirectionRight); keyUp(Key.DirectionRight) }
        compose.waitUntil(5000) { selected.id == "2" }
        dialog.performKeyInput { keyDown(Key.DirectionLeft); keyUp(Key.DirectionLeft) }
        compose.waitUntil(5000) { selected.id == "1" }
        dialog.performKeyInput { keyDown(Key.Escape); keyUp(Key.Escape) }
        compose.onNodeWithTag("drive-preview").assertDoesNotExist()
    }
}
