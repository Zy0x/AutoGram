package com.autogram.app.features.cloud.preview

import android.view.SurfaceView
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import com.autogram.app.R
import com.autogram.app.features.cloud.CloudFailure
import com.autogram.app.features.cloud.cloudErrorLabel
import kotlinx.coroutines.delay
import java.util.Locale

/** Initial seek is supplied before preparation; only 150ms of playable media gates start. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
internal fun CloudMediaPlayer(source: CloudRangeSource, modifier: Modifier, scope: PlaybackScope,
    audioOnly: Boolean = false, onRetry: () -> Unit = {}) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
    val preferences = remember(context) { AndroidPlaybackPreferences(context) }
    val history = remember(preferences) { PlaybackHistory(preferences) }
    val player = remember(source) { cloudPlayer(context, source) }
    var error by remember(source) { mutableStateOf<String?>(null) }
    var ready by remember(source) { mutableStateOf(false) }
    var buffering by remember(source) { mutableStateOf(true) }
    var completed by remember(source) { mutableStateOf(false) }
    var playing by remember(source) { mutableStateOf(false) }
    var resumeOnForeground by remember(source) { mutableStateOf(true) }
    var position by remember(source) { mutableLongStateOf(0) }
    var duration by remember(source) { mutableLongStateOf(0) }
    var aspect by remember(source) { mutableFloatStateOf(16f / 9f) }
    var rendered by remember(source) { mutableStateOf(false) }
    var drag by remember(source) { mutableStateOf<Float?>(null) }
    fun savePosition() {
        if (ready && !completed && preferences.rememberPosition) history.save(scope, player.currentPosition)
    }
    DisposableEffect(player, lifecycle) {
        val saved = if (preferences.rememberPosition) history.position(scope) else 0
        var checkedInitialPosition = false
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(value: Boolean) { playing = value }
            override fun onPlaybackStateChanged(state: Int) {
                buffering = state == Player.STATE_BUFFERING
                if (state == Player.STATE_READY) ready = true
                if (state == Player.STATE_ENDED) { completed = true; history.clear(scope) }
                duration = player.duration.takeIf { it != C.TIME_UNSET }?.coerceAtLeast(0) ?: 0
                if (!checkedInitialPosition && duration > 0 && saved >= (duration - 1000).coerceAtLeast(1)) {
                    checkedInitialPosition = true
                    completed = false; player.seekTo(0)
                }
            }
            override fun onRenderedFirstFrame() { rendered = true }
            override fun onVideoSizeChanged(size: VideoSize) {
                if (size.width > 0 && size.height > 0) aspect = size.width * size.pixelWidthHeightRatio / size.height
            }
            override fun onPlayerError(failure: PlaybackException) {
                var cause: Throwable? = failure
                while (cause != null && cause !is CloudFailure) cause = cause.cause
                error = (cause as? CloudFailure)?.code ?: if (failure.errorCode in 4000..4999)
                    "cloud_format_unsupported" else "cloud_read_failed"
                ready = false; buffering = false
            }
        }
        player.addListener(listener)
        player.setMediaItem(cloudMediaItem(), saved)
        player.playWhenReady = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
        player.prepare()
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) {
                resumeOnForeground = player.playWhenReady
                savePosition(); player.pause()
            } else if (event == Lifecycle.Event.ON_RESUME && resumeOnForeground) player.play()
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer); savePosition()
            player.removeListener(listener)
            // Native cancellation precedes release of the loader blocked on an RPC.
            runCatching { source.close() }; player.release()
        }
    }
    LaunchedEffect(player) {
        while (true) {
            position = player.currentPosition.coerceAtLeast(0)
            duration = player.duration.takeIf { it != C.TIME_UNSET }?.coerceAtLeast(0) ?: 0
            delay(250)
        }
    }
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            val width = minOf(maxWidth, maxHeight * aspect)
            if (!audioOnly) AndroidView(modifier = Modifier.width(width).height(width / aspect)
                .testTag(if (rendered) "preview-video-ready" else "preview-video-surface"), factory = { ctx ->
                SurfaceView(ctx).also { player.setVideoSurfaceView(it) }
            })
            if (audioOnly && error == null) Icon(Icons.Default.MusicNote, stringResource(R.string.real_audio), Modifier.size(80.dp))
            if (buffering && error == null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(); Text(stringResource(R.string.cloud_preview_loading))
            }
            error?.let { code -> Column(Modifier.testTag("preview-error"), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(cloudErrorLabel(code)))
                TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.drive_action_refresh)) }
            } }
        }
        if (error == null) Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(enabled = ready, modifier = Modifier.size(48.dp).testTag("preview-play"), onClick = {
                if (player.playWhenReady) { player.pause(); resumeOnForeground = false; savePosition() }
                else { if (completed) player.seekTo(0); completed = false; resumeOnForeground = true; player.play() }
            }) { Icon(if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                stringResource(if (playing) R.string.cloud_preview_pause else R.string.cloud_preview_play)) }
            Column(Modifier.weight(1f)) {
                val label = stringResource(R.string.cloud_preview_seek)
                Slider(value = drag ?: position.toFloat().coerceIn(0f, duration.toFloat()),
                    onValueChange = { drag = it }, enabled = ready && duration > 0,
                    valueRange = 0f..duration.coerceAtLeast(1).toFloat(),
                    modifier = Modifier.testTag("preview-seek").semantics { contentDescription = label },
                    onValueChangeFinished = { drag?.let { completed = false; player.seekTo(it.toLong()) }; drag = null })
                Text("${playbackTime(position)} / ${playbackTime(duration)}", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

private fun playbackTime(milliseconds: Long): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1000
    return if (seconds >= 3600) String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
    else String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60)
}
