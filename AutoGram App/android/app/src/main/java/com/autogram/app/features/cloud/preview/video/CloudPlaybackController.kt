package com.autogram.app.features.cloud.preview.video

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.provider.Settings
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.common.*
import androidx.media3.exoplayer.ExoPlayer
import com.autogram.app.features.cloud.CloudFailure
import com.autogram.app.features.cloud.preview.*
import kotlinx.coroutines.delay
import java.util.Locale

internal enum class VideoAspectMode { FIT, FILL, RATIO_16_9, ORIGINAL }

internal fun Context.previewActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.takeIf { it !== this }?.previewActivity()
    else -> null
}

/** UI state describes this actual player, never inferred from filenames or cache presence. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class CloudPlaybackController(val player: ExoPlayer, private val activity: Activity?, private val previewWindow: android.view.Window? = activity?.window) {
    var ready by mutableStateOf(false)
    var buffering by mutableStateOf(true)
    var completed by mutableStateOf(false)
    var playing by mutableStateOf(false)
    var wantsPlay by mutableStateOf(player.playWhenReady)
    var rendered by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var position by mutableLongStateOf(0)
    var duration by mutableLongStateOf(0)
    var aspect by mutableFloatStateOf(16f / 9f)
    var width by mutableIntStateOf(0)
    var height by mutableIntStateOf(0)
    var tracks by mutableStateOf(Tracks.EMPTY)
    var cues by mutableStateOf<List<androidx.media3.common.text.Cue>>(emptyList())
    var aspectMode by mutableStateOf(VideoAspectMode.FIT)
    var speed by mutableFloatStateOf(1f); private set
    var boosted by mutableStateOf(false); private set
    var looping by mutableStateOf(false); private set
    var locked by mutableStateOf(false)
    var volume by mutableFloatStateOf(player.volume); private set
    var brightness by mutableFloatStateOf(0.5f); private set
    var seekPreview by mutableStateOf<Long?>(null)
    var hud by mutableStateOf<VideoGestureMode?>(null)
    var controlsVisible by mutableStateOf(true)
    var interaction by mutableIntStateOf(0)
    var touching by mutableStateOf(false)
    var gestureEpoch by mutableIntStateOf(0)
    var resumeOnForeground = true
    var seekCommits = 0; private set
    private var beforeBoostPlaying = false
    private var disposed = false
    private val originalOrientation = activity?.requestedOrientation
    private val originalBrightness = previewWindow?.attributes?.screenBrightness

    init {
        brightness = originalBrightness?.takeIf { it >= 0 } ?: activity?.let {
            runCatching { Settings.System.getInt(it.contentResolver, Settings.System.SCREEN_BRIGHTNESS) / 255f }.getOrNull()
        } ?: 0.5f
    }
    fun touch() { interaction++; touching = true }
    fun finishTouch() { touching = false; interaction++ }
    fun showControls() { controlsVisible = true; interaction++ }
    fun toggleControls() { if (!locked) { controlsVisible = !controlsVisible; interaction++ } }
    fun togglePlay() {
        if (!ready || locked || disposed) return
        restoreBoost()
        if (player.playWhenReady) { player.pause(); resumeOnForeground = false }
        else { if (completed) player.seekTo(0); completed = false; resumeOnForeground = true; player.play() }
        showControls()
    }
    fun seek(target: Long) {
        if (!ready || duration <= 0 || locked || disposed) return
        completed = false; seekCommits++
        player.seekTo(target.coerceIn(0, (duration - 1).coerceAtLeast(0))); interaction++
    }
    fun selectSpeed(value: Float) { restoreBoost(); speed = value; player.setPlaybackSpeed(value); interaction++ }
    fun boost(value: Boolean) {
        if (!value) { restoreBoost(); return }
        if (boosted || !ready || locked || disposed) return
        beforeBoostPlaying = player.playWhenReady; boosted = true
        player.setPlaybackSpeed(VideoGesturePolicy.boostedSpeed(speed)); player.play()
        hud = VideoGestureMode.BOOST
    }
    fun restoreBoost() {
        if (!boosted || disposed) return
        boosted = false; player.setPlaybackSpeed(speed)
        player.playWhenReady = beforeBoostPlaying; hud = null
    }
    fun setLoop(value: Boolean) { looping = value; player.repeatMode = if (value) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF }
    fun adjustVolume(delta: Float) { volume = (volume + delta).coerceIn(0f, 1f); player.volume = volume; hud = VideoGestureMode.VOLUME }
    fun mute() { adjustVolume(if (volume > 0) -volume else 1f); hud = null }
    fun adjustBrightness(delta: Float) {
        brightness = (brightness + delta).coerceIn(0.05f, 1f)
        previewWindow?.let { window -> window.attributes = window.attributes.apply { screenBrightness = brightness } }
        hud = VideoGestureMode.BRIGHTNESS
    }
    fun rotate() {
        activity?.let { it.requestedOrientation = if (it.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE)
            ActivityInfo.SCREEN_ORIENTATION_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
    }
    fun releaseWindow() {
        restoreBoost(); disposed = true
        originalOrientation?.let { activity?.requestedOrientation = it }
        originalBrightness?.let { value -> previewWindow?.let { window -> window.attributes = window.attributes.apply { screenBrightness = value } } }
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
internal fun rememberCloudPlayback(source: CloudRangeSource, scope: PlaybackScope, historyStorage: PlaybackHistoryStorage? = null): CloudPlaybackController {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val preferences = remember(context) { AndroidPlaybackPreferences(context) }
    val history = remember(preferences, historyStorage) { PlaybackHistory(historyStorage ?: preferences) }
    val activity = context.previewActivity()
    val view = LocalView.current
    val window = (view.parent as? DialogWindowProvider)?.window ?: activity?.window
    val controller = remember(source, scope) { CloudPlaybackController(cloudPlayer(context, source), activity, window) }
    val player = controller.player
    DisposableEffect(controller, lifecycle) {
        fun save() { if (controller.ready && !controller.completed && preferences.rememberPosition) history.save(scope, player.currentPosition) }
        val saved = if (preferences.rememberPosition) history.position(scope) else 0
        var checked = false
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(value: Boolean) { controller.playing = value }
            override fun onPlayWhenReadyChanged(value: Boolean, reason: Int) { controller.wantsPlay = value }
            override fun onPlaybackStateChanged(state: Int) {
                controller.buffering = state == Player.STATE_BUFFERING
                // Once prepared, seeking must remain possible during a later network stall.
                if (state == Player.STATE_READY || state == Player.STATE_ENDED) controller.ready = true
                if (state == Player.STATE_ENDED) { controller.completed = true; history.clear(scope) }
                controller.duration = player.duration.takeIf { it != C.TIME_UNSET }?.coerceAtLeast(0) ?: 0
                if (!checked && controller.duration > 0) {
                    checked = true
                    if (saved >= (controller.duration - 1000).coerceAtLeast(1)) { controller.completed = false; player.seekTo(0) }
                }
            }
            override fun onRenderedFirstFrame() { controller.rendered = true }
            override fun onTracksChanged(tracks: Tracks) { controller.tracks = tracks }
            override fun onCues(cues: androidx.media3.common.text.CueGroup) { controller.cues = cues.cues }
            override fun onVideoSizeChanged(size: VideoSize) {
                if (size.width > 0 && size.height > 0) {
                    controller.width = size.width; controller.height = size.height
                    controller.aspect = size.width * size.pixelWidthHeightRatio / size.height
                }
            }
            override fun onPlayerError(failure: PlaybackException) {
                var cause: Throwable? = failure
                while (cause != null && cause !is CloudFailure) cause = cause.cause
                controller.error = (cause as? CloudFailure)?.code ?: if (failure.errorCode in 4000..4999) "cloud_format_unsupported" else "cloud_read_failed"
                controller.ready = false; controller.buffering = false
            }
        }
        player.addListener(listener); player.setMediaItem(cloudMediaItem(), saved)
        player.playWhenReady = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED); player.prepare()
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) {
                controller.gestureEpoch++
                controller.restoreBoost(); controller.resumeOnForeground = player.playWhenReady
                controller.seekPreview = null; controller.hud = null; controller.finishTouch()
                save(); player.pause()
            } else if (event == Lifecycle.Event.ON_RESUME && controller.resumeOnForeground) player.play()
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer); save(); player.removeListener(listener)
            controller.releaseWindow(); runCatching { source.close() }; player.release()
        }
    }
    LaunchedEffect(controller) { while (true) {
        controller.position = player.currentPosition.coerceAtLeast(0)
        controller.duration = player.duration.takeIf { it != C.TIME_UNSET }?.coerceAtLeast(0) ?: 0
        delay(250)
    } }
    return controller
}

internal fun playbackTime(milliseconds: Long): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1000
    return if (seconds >= 3600) String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
    else String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60)
}
