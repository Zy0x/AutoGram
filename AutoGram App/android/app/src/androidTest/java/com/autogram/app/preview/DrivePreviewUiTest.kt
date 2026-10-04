package com.autogram.app.preview

import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.R
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.ui.drive.DrivePreviewModal
import com.autogram.app.viewmodel.DriveFileItem
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Isolated UI fixtures only: no account, cloud writes, settings or history changes. */
class DrivePreviewUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun decodedImageSupportsDoubleTapZoomAndReset() {
        val bitmap = android.graphics.Bitmap.createBitmap(800, 400, android.graphics.Bitmap.Config.ARGB_8888)
        compose.setContent { AutoGramTheme {
            com.autogram.app.features.cloud.preview.CloudImageViewer(bitmap, "isolated-preview-fixture")
        } }
        val reset = InstrumentationRegistry.getInstrumentation().targetContext.getString(R.string.cloud_preview_reset_zoom)
        compose.onNodeWithText(reset).assertDoesNotExist()
        compose.onNodeWithTag("preview-image-ready").performTouchInput { doubleClick() }
        compose.onNodeWithText(reset).assertIsDisplayed().performTouchInput { click() }
        compose.onNodeWithText(reset).assertDoesNotExist()
    }
    @Test fun chromeRemainsReachableAndNavigatesBothDirectionsThenCloses() {
        val records = (1..3).map { DriveFileItem("$it", "preview-fixture-$it", 20, "text/plain", false, 0) }
        var selected by mutableStateOf(records.first())
        var visible by mutableStateOf(true)
        compose.setContent { AutoGramTheme {
            if (visible) DrivePreviewModal(selected, records, { visible = false }, { selected = it })
        } }
        compose.onNodeWithTag("preview-previous").assertIsNotEnabled()
        compose.onNodeWithTag("preview-next").assertHeightIsAtLeast(48.dp).performTouchInput { click() }
        compose.onNodeWithText("preview-fixture-2").assertIsDisplayed()
        compose.onNodeWithTag("preview-next").performTouchInput { click() }
        compose.onNodeWithTag("preview-next").assertIsNotEnabled()
        compose.onNodeWithTag("preview-previous").performTouchInput { click() }
        compose.onNodeWithText("preview-fixture-2").assertIsDisplayed()
        val close = InstrumentationRegistry.getInstrumentation().targetContext.getString(R.string.native_close)
        compose.onNodeWithContentDescription(close).assertHeightIsAtLeast(48.dp).performTouchInput { click() }
        compose.onNodeWithTag("drive-preview").assertDoesNotExist()
    }
}
