package com.autogram.app.runtime

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.R
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.ui.drive.FileGridItem
import com.autogram.app.ui.drive.ZipExplorerModal
import com.autogram.app.ui.transfer.TransferScreenContent
import com.autogram.app.viewmodel.*
import org.junit.Rule
import org.junit.Test

class RuntimeHonestyTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val item = DriveFileItem("fixture", "Hero Sync 4K.mp4", 100_000_000, "video/mp4", false, 0)

    @Test fun fileCardDoesNotInventQualityFromSizeOrName() {
        compose.setContent { AutoGramTheme { Box(Modifier.width(220.dp)) { FileGridItem(item, false, {}, {}) } } }
        compose.onNodeWithText(context.getString(R.string.real_video)).assertIsDisplayed()
        compose.onNodeWithText("4K UHD").assertDoesNotExist()
        compose.onNodeWithText("NVENC").assertDoesNotExist()
    }

    @Test fun archiveDoesNotShowSampleContentsOrSuccessfulExtraction() {
        compose.setContent { AutoGramTheme { ZipExplorerModal(item.copy(name = "actual.zip"), {}) } }
        compose.onNodeWithText(context.getString(R.string.real_preview_unavailable)).assertIsDisplayed()
        compose.onNodeWithText("cinematic_b_roll_4k.mp4").assertDoesNotExist()
    }

    @Test fun failedTransferNamedHeroIsNotLabeledSuccessfulOrDuplicate() {
        val task = TransferTaskItem("test", "Hero.mp4", 100, 10, 0, 0, "failed", "upload", false, 1, "", "")
        compose.setContent { AutoGramTheme {
            TransferScreenContent(TransferUiState(completedTasks = listOf(task)), onTogglePause = {}, onRetry = {})
        } }
        compose.onNodeWithText(context.getString(R.string.real_status_failed)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.real_status_completed)).assertDoesNotExist()
        compose.onNodeWithText(context.getString(R.string.real_status_skipped)).assertDoesNotExist()
    }
}
