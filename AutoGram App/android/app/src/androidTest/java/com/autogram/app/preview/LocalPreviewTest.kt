package com.autogram.app.preview

import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.widget.VideoView
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.autogram.app.features.preview.LocalMediaContent
import com.autogram.app.theme.AutoGramTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class LocalPreviewTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun textPreviewShowsBytesFromGrantedContentProvider() {
        compose.setContent { AutoGramTheme {
            LocalMediaContent(Uri.parse("content://com.autogram.app.test.preview/note"), Modifier.fillMaxSize())
        } }
        compose.waitUntil(5000) {
            compose.onAllNodesWithText("Actual provider content — UTF-8").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Actual provider content — UTF-8").assertIsDisplayed()
    }

    @Test fun audioPlaybackUsesRealMediaDurationAndPosition() {
        compose.setContent { AutoGramTheme {
            LocalMediaContent(Uri.parse("content://com.autogram.app.test.preview/tone"), Modifier.fillMaxSize())
        } }
        var measuredPosition = 0
        compose.waitUntil(10000) {
            compose.runOnUiThread {
                val player = findPlayer(compose.activity.window.decorView)
                if (player != null && player.duration > 0) measuredPosition = player.currentPosition
            }
            measuredPosition > 100
        }
        compose.runOnUiThread {
            val player = requireNotNull(findPlayer(compose.activity.window.decorView))
            assertTrue(player.duration in 2800..3200)
            player.pause()
            assertFalse(player.isPlaying)
        }
    }

    private fun findPlayer(view: View): VideoView? {
        if (view is VideoView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) {
            findPlayer(view.getChildAt(index))?.let { return it }
        }
        return null
    }
}
