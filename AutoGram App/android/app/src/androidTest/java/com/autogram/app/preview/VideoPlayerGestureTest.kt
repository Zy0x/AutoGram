package com.autogram.app.preview

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.media3.common.C
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.R
import com.autogram.app.features.cloud.preview.*
import com.autogram.app.features.cloud.preview.controls.*
import com.autogram.app.features.cloud.preview.video.*
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.ui.drive.DrivePreviewModal
import com.autogram.app.ui.keepUnlockedFixtureAwake
import com.autogram.app.viewmodel.DriveFileItem
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Real decoded MP4, real production controller: no accounts, settings or user history writes. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class VideoPlayerGestureTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Before fun unlocked() = keepUnlockedFixtureAwake { compose.activity }
    private lateinit var controller: CloudPlaybackController
    private val navigations = mutableListOf<Int>()
    private val fixtureHistory = object : PlaybackHistoryStorage {
        override fun long(key: String) = 0L
        override fun save(key: String, position: Long, updated: Long) {}
        override fun remove(key: String) {}
    }
    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)
    private val bytes by lazy { InstrumentationRegistry.getInstrumentation().context.assets.open("video-gestures.mp4").use { it.readBytes() } }
    private fun source(closed: () -> Unit = {}) = CloudRangeSource(bytes.size.toLong(), { offset, length ->
        bytes.copyOfRange(offset.toInt(), offset.toInt() + length)
    }, closed)
    private fun SemanticsNodeInteraction.touchWhenResumed(
        activityWindow: Boolean = true,
        action: TouchInjectionScope.() -> Unit,
    ) {
        // Surface readiness doesn't imply that Android restored window focus after
        // a popup/lifecycle transition. Wait without reopening or resetting fixtures.
        val activity = compose.activity
        try {
            compose.waitUntil(5000) {
                var focused = false
                InstrumentationRegistry.getInstrumentation().runOnMainSync {
                    // Dialog previews own a separate focused window. Their mounted
                    // semantic root is required, not focus on the parent Activity.
                    focused = (!activityWindow || activity.hasWindowFocus()) && !activity.isFinishing && !activity.isDestroyed
                }
                if (!focused) false else try {
                    compose.onAllNodesWithTag("preview-video-gestures").fetchSemanticsNodes().isNotEmpty()
                } catch (failure: IllegalStateException) {
                    if (failure.message?.startsWith("No compose hierarchies found") == true) false else throw failure
                }
            }
        } catch (failure: ComposeTimeoutException) {
            throw AssertionError("video fixture unavailable: finishing=${activity.isFinishing}, destroyed=${activity.isDestroyed}, focused=${activity.hasWindowFocus()}", failure)
        }
        performTouchInput(action)
    }
    private fun setup() {
        val source = source()
        compose.setContent { AutoGramTheme {
            CompositionLocalProvider(LocalPreviewNavigation provides { delta -> navigations.add(delta); true }) {
                val c = rememberCloudPlayback(source, PlaybackScope("isolated-fixture", "video", 1), fixtureHistory)
                SideEffect { controller = c }
                LaunchedEffect(c) { c.adjustVolume(-c.volume); c.hud = null }
                CloudPlaybackView(c, bytes.size.toLong(), Modifier.fillMaxSize(), false, {})
            }
        } }
        compose.waitUntil(10000) { ::controller.isInitialized && controller.rendered && controller.ready }
        compose.runOnIdle { controller.player.pause(); controller.seek(30000) }
    }

    @Test fun centreDragCommitsOnceAndNeverChangesMedia() {
        setup()
        var commits = 0
        compose.runOnIdle { commits = controller.seekCommits }
        compose.onNodeWithTag("preview-video-gestures").touchWhenResumed {
            swipe(start = Offset(width * .45f, height * .45f), end = Offset(width * .75f, height * .45f), durationMillis = 500)
        }
        compose.runOnIdle {
            assertEquals(commits + 1, controller.seekCommits)
            assertTrue(controller.player.currentPosition >= 60000)
            assertTrue(navigations.isEmpty()); assertNull(controller.seekPreview)
        }
    }
    @Test fun holdBoostRestoresSpeedAndPausedStateOnReleaseAndCancel() {
        setup()
        compose.runOnIdle { controller.selectSpeed(1.5f) }
        val gestures = compose.onNodeWithTag("preview-video-gestures")
        gestures.touchWhenResumed { down(center) }
        compose.waitUntil(3000) { controller.boosted }
        compose.runOnIdle { assertEquals(3f, controller.player.playbackParameters.speed, 0f) }
        gestures.touchWhenResumed { up() }
        compose.runOnIdle {
            assertFalse(controller.boosted); assertEquals(1.5f, controller.player.playbackParameters.speed, 0f)
            assertFalse(controller.player.playWhenReady); assertTrue(navigations.isEmpty())
        }
        gestures.touchWhenResumed { down(center) }
        compose.waitUntil(3000) { controller.boosted }
        gestures.touchWhenResumed { cancel() }
        compose.runOnIdle { assertFalse(controller.boosted); assertFalse(controller.player.playWhenReady) }
    }
    @Test fun backgroundCancelsHoldAndDoesNotResumeAPausedVideo() {
        setup()
        compose.onNodeWithTag("preview-video-gestures").touchWhenResumed { down(center) }
        compose.waitUntil(3000) { controller.boosted }
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.STARTED)
        compose.runOnIdle { assertFalse(controller.boosted); assertFalse(controller.player.playWhenReady) }
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
        compose.onNodeWithTag("preview-video-gestures").touchWhenResumed { cancel() }
        compose.runOnIdle { assertFalse(controller.player.playWhenReady); assertTrue(navigations.isEmpty()) }
    }
    @Test fun brightnessAndVolumeStayLocalAndWindowSettingsAreRestored() {
        setup()
        val original = compose.activity.window.attributes.screenBrightness
        val audio = compose.activity.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
        val systemVolume = audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)
        compose.runOnIdle {
            controller.adjustBrightness(.2f); controller.adjustVolume(.2f)
            assertEquals(controller.brightness, compose.activity.window.attributes.screenBrightness, 0f)
            assertEquals(controller.volume, controller.player.volume, 0f)
            assertEquals(systemVolume, audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC))
            controller.releaseWindow()
            assertEquals(original, compose.activity.window.attributes.screenBrightness, 0f)
        }
    }
    @Test fun deliberateGallerySwipeWorksButShortAndDiagonalDoNot() {
        setup()
        val gestures = compose.onNodeWithTag("preview-video-gestures")
        gestures.touchWhenResumed { swipe(Offset(width * .93f, height * .45f), Offset(width * .8f, height * .45f), 300) }
        gestures.touchWhenResumed { swipe(Offset(width * .93f, height * .4f), Offset(width * .55f, height * .8f), 300) }
        compose.runOnIdle { assertTrue(navigations.isEmpty()) }
        gestures.touchWhenResumed { swipe(Offset(width * .93f, height * .45f), Offset(width * .3f, height * .45f), 500) }
        compose.runOnIdle { assertEquals(listOf(1), navigations) }
        gestures.touchWhenResumed {
            down(0, Offset(width * .3f, height * .45f)); down(1, Offset(width * .3f, height * .55f))
            repeat(10) { index ->
                val x = width * (.3f + (index + 1) * .05f)
                moveTo(0, Offset(x, height * .45f), 30); moveTo(1, Offset(x, height * .55f), 0)
            }
            up(0); up(1)
        }
        compose.runOnIdle { assertEquals(listOf(1, -1), navigations) }
    }
    @Test fun doubleTapSliderAndLockRemainDisjointFromGallery() {
        setup()
        var commits = 0
        compose.runOnIdle { commits = controller.seekCommits }
        compose.onNodeWithTag("preview-video-gestures").touchWhenResumed { doubleClick(Offset(width * .75f, height * .4f)) }
        compose.runOnIdle { assertEquals(commits + 1, controller.seekCommits); assertTrue(navigations.isEmpty()) }
        compose.onNodeWithTag("preview-seek").touchWhenResumed { swipeLeft() }
        compose.runOnIdle { assertEquals(commits + 2, controller.seekCommits); assertTrue(navigations.isEmpty()) }
        compose.onNodeWithContentDescription(text(R.string.clean_gallery_actions)).performClick()
        compose.onNodeWithText(text(R.string.player_lock)).performClick()
        compose.onNodeWithTag("preview-video-gestures").touchWhenResumed { swipeLeft(); doubleClick() }
        compose.runOnIdle { assertTrue(controller.locked); assertEquals(commits + 2, controller.seekCommits); assertTrue(navigations.isEmpty()) }
        compose.onNodeWithContentDescription(text(R.string.clean_gallery_actions)).performClick()
        compose.onNodeWithText(text(R.string.player_unlock)).performClick()
        compose.runOnIdle { assertFalse(controller.locked) }
    }
    @Test fun hiddenToolsExposeActualTracksAndApplyRepeatSpeedAspect() {
        setup()
        fun more() = compose.onNodeWithContentDescription(text(R.string.clean_gallery_actions)).performClick()
        compose.onNodeWithText(text(R.string.video_speed_title)).assertDoesNotExist()
        more(); compose.onNodeWithText(text(R.string.video_speed_title)).performClick()
        compose.onNodeWithText("1.5x").performClick()
        more(); compose.onNodeWithText(text(R.string.video_loop_disabled)).performClick()
        more(); compose.onNodeWithText(text(R.string.player_aspect)).performClick()
        compose.onNodeWithText(text(R.string.video_aspect_fill)).performClick()
        compose.runOnIdle {
            assertEquals(1.5f, controller.player.playbackParameters.speed, 0f)
            assertEquals(androidx.media3.common.Player.REPEAT_MODE_ONE, controller.player.repeatMode)
            assertEquals(VideoAspectMode.FILL, controller.aspectMode)
            assertEquals(2, controller.tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.sumOf { it.length })
            assertTrue(controller.tracks.groups.any { it.type == C.TRACK_TYPE_TEXT })
        }
        val audioGroup = controller.tracks.groups.last { it.type == C.TRACK_TYPE_AUDIO }
        fun trackLabel(format: androidx.media3.common.Format) = listOfNotNull(format.label, format.language?.takeIf { it != "und" }, format.sampleMimeType).distinct().joinToString(" · ")
        more(); compose.onNodeWithText(text(R.string.player_audio_tracks)).performClick()
        compose.onNodeWithText(trackLabel(audioGroup.getTrackFormat(0))).performClick()
        compose.waitUntil(5000) { controller.tracks.groups.any { it.mediaTrackGroup == audioGroup.mediaTrackGroup && it.isTrackSelected(0) } }
        more(); compose.onNodeWithText(text(R.string.player_subtitle_tracks)).performClick()
        compose.onNodeWithText(trackLabel(controller.tracks.groups.first { it.type == C.TRACK_TYPE_TEXT }.getTrackFormat(0))).performClick()
        compose.waitUntil(5000) { controller.cues.isNotEmpty() }
    }
    @Test fun dialogSharesOneOverflowAndOnlyOneVideoStreamOwnsPlayback() {
        val records = (1..3).map { DriveFileItem("$it", "isolated-video-$it.mp4", bytes.size.toLong(), "video/mp4", false, 0) }
        var selected by mutableStateOf(records.first())
        val closed = AtomicInteger()
        val owners = mutableSetOf<String>()
        var maxOwners = 0
        compose.setContent { AutoGramTheme {
            DrivePreviewModal(selected, records, {}, { selected = it }, previewContent = { row, _ ->
                val source = remember(row.id) { source { closed.incrementAndGet() } }
                val c = rememberCloudPlayback(source, PlaybackScope("isolated", "video", row.id.toInt()), fixtureHistory)
                SideEffect { controller = c }
                LaunchedEffect(c) { c.adjustVolume(-c.volume); c.hud = null }
                DisposableEffect(row.id) {
                    owners.add(row.id); maxOwners = maxOf(maxOwners, owners.size)
                    onDispose { owners.remove(row.id) }
                }
                CloudPlaybackView(c, bytes.size.toLong(), Modifier.fillMaxSize(), false, {})
            })
        } }
        compose.waitUntil(10000) { ::controller.isInitialized && controller.rendered && controller.ready }
        compose.onAllNodesWithContentDescription(text(R.string.clean_gallery_actions)).assertCountEquals(1)
        compose.onNodeWithTag("preview-video-gestures").touchWhenResumed(activityWindow = false) {
            swipe(Offset(width * .93f, height * .45f), Offset(width * .3f, height * .45f), 500)
        }
        compose.waitUntil(5000) { selected.id == "2" && owners == setOf("2") }
        compose.runOnIdle { assertEquals(1, maxOwners); assertTrue(closed.get() > 0) }
        compose.onNodeWithTag("preview-previous").performClick()
        compose.waitUntil(5000) { selected.id == "1" }
    }
}
