package com.autogram.app.features.cloud.preview

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.SurfaceView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.autogram.app.theme.*
import kotlinx.coroutines.delay
import java.util.Locale

enum class VideoAspectMode {
    FIT, FILL, RATIO_16_9, ORIGINAL
}

/** Initial seek is supplied before preparation; only 150ms of playable media gates start. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
internal fun CloudMediaPlayer(
    source: CloudRangeSource,
    modifier: Modifier,
    scope: PlaybackScope,
    audioOnly: Boolean = false,
    onRetry: () -> Unit = {}
) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
    val activity = context as? Activity
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

    // MX-Player Controls State
    var aspectMode by remember { mutableStateOf(VideoAspectMode.FIT) }
    var rawVideoWidth by remember { mutableIntStateOf(0) }
    var rawVideoHeight by remember { mutableIntStateOf(0) }
    var currentSpeed by remember { mutableFloatStateOf(1.0f) }
    var showSpeedMenu by remember { mutableStateOf(false) }
    var isLooping by remember { mutableStateOf(false) }
    var showTechInfo by remember { mutableStateOf(false) }
    val speedOptions = remember { listOf(0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 2.0f) }

    fun savePosition() {
        if (ready && !completed && preferences.rememberPosition) history.save(scope, player.currentPosition)
    }

    DisposableEffect(Unit) {
        onDispose {
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
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
                if (size.width > 0 && size.height > 0) {
                    rawVideoWidth = size.width
                    rawVideoHeight = size.height
                    aspect = size.width * size.pixelWidthHeightRatio / size.height
                }
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
        BoxWithConstraints(
            Modifier.weight(1f).fillMaxWidth().clipToBounds(),
            contentAlignment = Alignment.Center
        ) {
            if (!audioOnly) {
                val videoModifier = when (aspectMode) {
                    VideoAspectMode.FIT -> {
                        val width = minOf(maxWidth, maxHeight * aspect)
                        Modifier.width(width).height(width / aspect)
                    }
                    VideoAspectMode.FILL -> {
                        val width = maxOf(maxWidth, maxHeight * aspect)
                        Modifier.width(width).height(width / aspect)
                    }
                    VideoAspectMode.RATIO_16_9 -> {
                        val targetAspect = 16f / 9f
                        val width = minOf(maxWidth, maxHeight * targetAspect)
                        Modifier.width(width).height(width / targetAspect)
                    }
                    VideoAspectMode.ORIGINAL -> {
                        if (rawVideoWidth > 0 && rawVideoHeight > 0) {
                            val density = LocalDensity.current.density
                            val wDp = (rawVideoWidth / density).dp
                            val hDp = (rawVideoHeight / density).dp
                            Modifier.widthIn(max = maxWidth).heightIn(max = maxHeight).size(wDp, hDp)
                        } else {
                            val width = minOf(maxWidth, maxHeight * aspect)
                            Modifier.width(width).height(width / aspect)
                        }
                    }
                }

                AndroidView(
                    modifier = videoModifier.testTag(if (rendered) "preview-video-ready" else "preview-video-surface"),
                    factory = { ctx -> SurfaceView(ctx).also { player.setVideoSurfaceView(it) } }
                )
            }

            if (audioOnly && error == null) {
                Icon(Icons.Default.MusicNote, stringResource(R.string.real_audio), Modifier.size(80.dp))
            }

            if (buffering && error == null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Text(stringResource(R.string.cloud_preview_loading))
                }
            }

            error?.let { code ->
                Column(Modifier.testTag("preview-error"), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(stringResource(cloudErrorLabel(code)))
                    TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.drive_action_refresh))
                    }
                }
            }

            // Technical info overlay
            if (showTechInfo) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = SurfaceElevatedDark.copy(alpha = 0.92f),
                    border = BorderStroke(1.dp, MutedIceCyan.copy(alpha = 0.5f)),
                    modifier = Modifier
                        .padding(16.dp)
                        .align(Alignment.TopCenter)
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = stringResource(R.string.video_tech_info_title),
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                color = MutedIceCyan
                            )
                            IconButton(
                                onClick = { showTechInfo = false },
                                modifier = Modifier.size(24.dp)
                            ) {
                                Icon(Icons.Default.Close, null, tint = TextMutedDark, modifier = Modifier.size(16.dp))
                            }
                        }
                        Text(
                            text = stringResource(R.string.video_tech_resolution, if (rawVideoWidth > 0) "${rawVideoWidth}x${rawVideoHeight}" else "N/A"),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                            color = TextPrimaryDark
                        )
                        Text(
                            text = stringResource(R.string.video_tech_duration, playbackTime(duration)),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                            color = TextPrimaryDark
                        )
                        Text(
                            text = stringResource(R.string.video_tech_format, "MTProto Direct Stream / ExoPlayer"),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                            color = TextPrimaryDark
                        )
                        Text(
                            text = stringResource(R.string.video_tech_size, "${source.size / (1024 * 1024)} MB"),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                            color = TextPrimaryDark
                        )
                    }
                }
            }
        }

        // Playback Seekbar & Main Controls
        if (error == null) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(enabled = ready, modifier = Modifier.size(48.dp).testTag("preview-play"), onClick = {
                    if (player.playWhenReady) { player.pause(); resumeOnForeground = false; savePosition() }
                    else { if (completed) player.seekTo(0); completed = false; resumeOnForeground = true; player.play() }
                }) {
                    Icon(
                        if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                        stringResource(if (playing) R.string.cloud_preview_pause else R.string.cloud_preview_play)
                    )
                }
                Column(Modifier.weight(1f)) {
                    val label = stringResource(R.string.cloud_preview_seek)
                    Slider(
                        value = drag ?: position.toFloat().coerceIn(0f, duration.toFloat()),
                        onValueChange = { drag = it },
                        enabled = ready && duration > 0,
                        valueRange = 0f..duration.coerceAtLeast(1).toFloat(),
                        modifier = Modifier.testTag("preview-seek").semantics { contentDescription = label },
                        onValueChangeFinished = { drag?.let { completed = false; player.seekTo(it.toLong()) }; drag = null }
                    )
                    Text("${playbackTime(position)} / ${playbackTime(duration)}", style = MaterialTheme.typography.labelSmall)
                }
            }

            // MX-Player Advanced Media Controls Toolbar
            if (!audioOnly) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    // -10s Rewind
                    IconButton(
                        onClick = {
                            val newPos = (player.currentPosition - 10_000).coerceAtLeast(0)
                            player.seekTo(newPos)
                        },
                        enabled = ready,
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Replay10,
                            contentDescription = stringResource(R.string.video_seek_rewind),
                            tint = TextPrimaryDark,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    // +10s Forward
                    IconButton(
                        onClick = {
                            val newPos = (player.currentPosition + 10_000).coerceAtMost(duration)
                            player.seekTo(newPos)
                        },
                        enabled = ready && duration > 0,
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Forward10,
                            contentDescription = stringResource(R.string.video_seek_forward),
                            tint = TextPrimaryDark,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    // Aspect Ratio Cycle Mode [ Fit / Fill / 16:9 / Original ]
                    Surface(
                        onClick = {
                            aspectMode = when (aspectMode) {
                                VideoAspectMode.FIT -> VideoAspectMode.FILL
                                VideoAspectMode.FILL -> VideoAspectMode.RATIO_16_9
                                VideoAspectMode.RATIO_16_9 -> VideoAspectMode.ORIGINAL
                                VideoAspectMode.ORIGINAL -> VideoAspectMode.FIT
                            }
                        },
                        shape = RoundedCornerShape(8.dp),
                        color = SurfaceElevatedDark,
                        border = BorderStroke(1.dp, BorderHairline),
                        modifier = Modifier.height(32.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 8.dp)) {
                            val modeLabel = when (aspectMode) {
                                VideoAspectMode.FIT -> stringResource(R.string.video_aspect_fit)
                                VideoAspectMode.FILL -> stringResource(R.string.video_aspect_fill)
                                VideoAspectMode.RATIO_16_9 -> stringResource(R.string.video_aspect_16_9)
                                VideoAspectMode.ORIGINAL -> stringResource(R.string.video_aspect_original)
                            }
                            Text(
                                text = modeLabel,
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium, fontSize = 11.sp),
                                color = MutedIceCyan
                            )
                        }
                    }

                    // Playback Speed Controller
                    Box {
                        Surface(
                            onClick = { showSpeedMenu = true },
                            shape = RoundedCornerShape(8.dp),
                            color = SurfaceElevatedDark,
                            border = BorderStroke(1.dp, BorderHairline),
                            modifier = Modifier.height(32.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = 8.dp)) {
                                Text(
                                    text = "${currentSpeed}x",
                                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp),
                                    color = GoldAccent
                                )
                            }
                        }
                        DropdownMenu(
                            expanded = showSpeedMenu,
                            onDismissRequest = { showSpeedMenu = false }
                        ) {
                            speedOptions.forEach { spd ->
                                DropdownMenuItem(
                                    text = {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                                        ) {
                                            Text("${spd}x")
                                            if (spd == currentSpeed) {
                                                Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp), tint = MutedIceCyan)
                                            }
                                        }
                                    },
                                    onClick = {
                                        currentSpeed = spd
                                        player.setPlaybackSpeed(spd)
                                        showSpeedMenu = false
                                    }
                                )
                            }
                        }
                    }

                    // Repeat / Loop Toggle
                    IconButton(
                        onClick = {
                            isLooping = !isLooping
                            player.repeatMode = if (isLooping) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
                        },
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = if (isLooping) Icons.Default.RepeatOne else Icons.Default.Repeat,
                            contentDescription = if (isLooping) stringResource(R.string.video_loop_enabled) else stringResource(R.string.video_loop_disabled),
                            tint = if (isLooping) MutedIceCyan else TextMutedDark,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    // Fullscreen / Rotate Screen Toggle
                    IconButton(
                        onClick = {
                            activity?.let { act ->
                                val currentOrientation = act.requestedOrientation
                                act.requestedOrientation = if (currentOrientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE) {
                                    ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                                } else {
                                    ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                                }
                            }
                        },
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.ScreenRotation,
                            contentDescription = stringResource(R.string.video_rotate_screen),
                            tint = TextPrimaryDark,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    // Technical Media Info
                    IconButton(
                        onClick = { showTechInfo = !showTechInfo },
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = stringResource(R.string.video_tech_info_title),
                            tint = if (showTechInfo) MutedIceCyan else TextMutedDark,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }
        }
    }
}

private fun playbackTime(milliseconds: Long): String {
    val seconds = milliseconds.coerceAtLeast(0) / 1000
    return if (seconds >= 3600) String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
    else String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60)
}
