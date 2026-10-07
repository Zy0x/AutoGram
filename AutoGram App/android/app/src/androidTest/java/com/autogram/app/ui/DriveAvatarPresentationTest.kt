package com.autogram.app.ui

import android.graphics.Bitmap
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.autogram.app.features.cloud.*
import com.autogram.app.features.cloud.avatars.*
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.ui.drive.gallery.DriveStories
import java.io.ByteArrayOutputStream
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.assertEquals

/** Pure isolated presentation fixture: never initializes auth/native or writes user records. */
@RunWith(AndroidJUnit4::class)
class DriveAvatarPresentationTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Before fun requireUnlockedDevice() { keepUnlockedFixtureAwake { compose.activity } }
    private fun png(): ByteArray {
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.rgb(40, 140, 120))
        return ByteArrayOutputStream().use { output ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
            bitmap.recycle(); output.toByteArray()
        }
    }
    @Test fun actualPhotoDecodesInExpandedAndCompactRowWithoutDuplicateTitle() {
        var compact by mutableStateOf(false)
        var loads = 0
        val location = CloudLocation("7", "Fixture chat", "forum", "server-photo")
        val state = CloudState(scope = CloudScope("fixture", "7"), locations = listOf(location))
        val avatars = CloudAvatarState("fixture", mapOf(AvatarKey("7", "server-photo") to png()))
        compose.setContent { AutoGramTheme { DriveStories(state, {}, {}, compact = compact,
            avatars = avatars, onAvatar = { _, _ -> loads++ }) } }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("drive-location-photo-ready", useUnmergedTree = true).fetchSemanticsNodes().size == 1 }
        compose.onNodeWithTag("drive-location:7").assertIsDisplayed().assertIsSelected()
        compose.onAllNodesWithText("Fixture chat").assertCountEquals(1)
        compose.runOnIdle { compact = true }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("drive-location-photo-ready", useUnmergedTree = true).fetchSemanticsNodes().size == 1 }
        compose.onNodeWithTag("drive-location:7").assertHeightIsAtLeast(androidx.compose.ui.unit.Dp(48f))
        compose.runOnIdle { assertEquals(1, loads) }
    }
    @Test fun foreignAccountPhotoIsNotRendered() {
        val location = CloudLocation("7", "Fixture chat", "forum", "server-photo")
        val state = CloudState(scope = CloudScope("B", "7"), locations = listOf(location))
        compose.setContent { AutoGramTheme { DriveStories(state, {}, {}, avatars = CloudAvatarState("A",
            mapOf(AvatarKey("7", "server-photo") to png()))) } }
        compose.onAllNodesWithTag("drive-location-photo-ready", useUnmergedTree = true).assertCountEquals(0)
        compose.onAllNodesWithTag("drive-location-photo-loading", useUnmergedTree = true).assertCountEquals(0)
        compose.onNodeWithTag("drive-location:7").assertIsDisplayed()
    }
}
