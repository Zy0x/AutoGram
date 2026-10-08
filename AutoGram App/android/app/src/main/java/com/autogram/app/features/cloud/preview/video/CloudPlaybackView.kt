package com.autogram.app.features.cloud.preview.video

import android.view.SurfaceView
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.SubtitleView
import com.autogram.app.R
import com.autogram.app.features.cloud.cloudErrorLabel
import com.autogram.app.features.cloud.preview.controls.*
import kotlinx.coroutines.delay

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
internal fun CloudPlaybackView(c: CloudPlaybackController, byteSize: Long, modifier: Modifier, audioOnly: Boolean, onRetry: () -> Unit) {
    val density = LocalDensity.current.density
    val navigate by rememberUpdatedState(LocalPreviewNavigation.current)
    val tools = videoPreviewTools(c, byteSize, audioOnly)
    var drag by remember(c) { mutableStateOf<Float?>(null) }
    val rewind = stringResource(R.string.video_seek_rewind)
    val forward = stringResource(R.string.video_seek_forward)
    val play = stringResource(if (c.wantsPlay && !c.completed) R.string.cloud_preview_pause else R.string.cloud_preview_play)
    val showControls = stringResource(R.string.player_show_controls)
    LaunchedEffect(c, c.playing, c.buffering, c.interaction, c.touching, c.controlsVisible, drag) {
        if (c.playing && !c.buffering && !c.touching && drag == null && c.controlsVisible && !audioOnly) {
            delay(3000); c.controlsVisible = false
        }
    }
    LaunchedEffect(c.hud, c.touching) { if (!c.touching && c.hud != null) { delay(700); c.hud = null } }
    BoxWithConstraints(modifier.clipToBounds(), contentAlignment = Alignment.Center) {
        if (!audioOnly) {
            val videoModifier = when (c.aspectMode) {
                VideoAspectMode.FIT -> { val w = minOf(maxWidth, maxHeight * c.aspect); Modifier.width(w).height(w / c.aspect) }
                VideoAspectMode.FILL -> { val w = maxOf(maxWidth, maxHeight * c.aspect); Modifier.width(w).height(w / c.aspect) }
                VideoAspectMode.RATIO_16_9 -> { val w = minOf(maxWidth, maxHeight * (16f / 9f)); Modifier.width(w).height(w * 9 / 16) }
                VideoAspectMode.ORIGINAL -> {
                    val w = minOf(maxWidth, (c.width / density).dp.takeIf { c.width > 0 } ?: maxWidth, maxHeight * c.aspect)
                    Modifier.width(w).height(w / c.aspect)
                }
            }
            key(c) {
                AndroidView(modifier = videoModifier.testTag(if (c.rendered) "preview-video-ready" else "preview-video-surface"),
                    factory = { SurfaceView(it).also(c.player::setVideoSurfaceView) })
            }
            AndroidView(modifier = Modifier.fillMaxSize(), factory = { SubtitleView(it) }, update = {
                it.setCues(c.cues); it.setBottomPaddingFraction(if (c.controlsVisible) 0.18f else 0.08f)
            })
            Box(Modifier.fillMaxSize().testTag("preview-video-gestures").semantics {
                onClick(showControls) { if (c.locked) false else { c.showControls(); true } }
                customActions = if (c.locked) emptyList() else listOf(
                    CustomAccessibilityAction(rewind) { c.seek(c.player.currentPosition - 10000); true },
                    CustomAccessibilityAction(forward) { c.seek(c.player.currentPosition + 10000); true },
                    CustomAccessibilityAction(play) { c.togglePlay(); true })
            }.onPreviewKeyEvent {
                if (c.locked || it.type != KeyEventType.KeyUp) false else when (it.key) {
                    Key.Spacebar -> { c.togglePlay(); true }
                    Key.DirectionLeft -> { c.seek(c.player.currentPosition - 10000); c.showControls(); true }
                    Key.DirectionRight -> { c.seek(c.player.currentPosition + 10000); c.showControls(); true }
                    else -> false
                }
            }.focusable().pointerInput(c, density) {
                videoTouchGestures(density, VideoGestureCallbacks(
                    locked = { c.locked }, canSeek = { c.ready && c.duration > 0 },
                    position = { c.player.currentPosition }, duration = { c.duration },
                    previewSeek = { c.seekPreview = it; if (it != null) { c.touch(); c.hud = VideoGestureMode.SEEK } },
                    commitSeek = c::seek, boost = { c.touch(); c.boost(it) },
                    volume = { c.touch(); c.adjustVolume(it) }, brightness = { c.touch(); c.adjustBrightness(it) },
                    navigate = { navigate(it) }, finish = { c.finishTouch() }, epoch = { c.gestureEpoch }))
            }.pointerInput(c) {
                detectTapGestures(onTap = { c.toggleControls() }, onDoubleTap = { point ->
                    if (!c.locked) when {
                        point.x < size.width / 3f -> { c.seek(c.player.currentPosition - 10000); c.showControls() }
                        point.x > size.width * 2f / 3f -> { c.seek(c.player.currentPosition + 10000); c.showControls() }
                        else -> c.togglePlay()
                    }
                }, onLongPress = {})
            })
        } else Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(if (c.playing) Icons.Default.GraphicEq else Icons.Default.MusicNote,
                stringResource(R.string.real_audio), modifier = Modifier.size(96.dp))
            Text(stringResource(if (c.buffering) R.string.cloud_preview_loading else if (c.playing) R.string.audio_playing else R.string.audio_paused))
        }
        if (c.buffering && c.error == null) CircularProgressIndicator(Modifier.testTag("preview-buffering"))
        c.error?.let { code -> Column(Modifier.testTag("preview-error"), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(cloudErrorLabel(code)))
            TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.drive_action_refresh)) }
        } }
        val hud = when (c.hud) {
            VideoGestureMode.SEEK -> c.seekPreview?.let { playbackTime(it) }
            VideoGestureMode.BOOST -> stringResource(R.string.player_hold_speed, VideoGesturePolicy.boostedSpeed(c.speed))
            VideoGestureMode.VOLUME -> stringResource(R.string.player_volume_value, (c.volume * 100).toInt())
            VideoGestureMode.BRIGHTNESS -> stringResource(R.string.player_brightness_value, (c.brightness * 100).toInt())
            else -> null
        }
        if (hud != null) Surface(color = Color.Black.copy(alpha = 0.8f), shape = MaterialTheme.shapes.medium) {
            Text(hud, Modifier.padding(16.dp).testTag("preview-video-hud"))
        }
        if (!c.locked && c.error == null && (c.controlsVisible || !c.playing || audioOnly)) {
            Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black.copy(alpha = 0.68f)).padding(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                IconButton(enabled = c.ready, onClick = c::togglePlay, modifier = Modifier.size(48.dp).testTag("preview-play")) {
                    Icon(if (c.wantsPlay && !c.completed) Icons.Default.Pause else Icons.Default.PlayArrow, play)
                }
                Column(Modifier.weight(1f)) {
                    val seekLabel = stringResource(R.string.cloud_preview_seek)
                    Slider(value = drag ?: (c.seekPreview ?: c.position).toFloat().coerceIn(0f, c.duration.toFloat()),
                        onValueChange = { c.touch(); drag = it }, enabled = c.ready && c.duration > 0,
                        valueRange = 0f..c.duration.coerceAtLeast(1).toFloat(),
                        modifier = Modifier.heightIn(min = 48.dp).testTag("preview-seek").semantics { contentDescription = seekLabel },
                        onValueChangeFinished = { drag?.let { c.seek(it.toLong()) }; drag = null; c.finishTouch() })
                    Text("${playbackTime((drag?.toLong() ?: c.seekPreview) ?: c.position)} / ${playbackTime(c.duration)}", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        StandalonePreviewTools(tools, Modifier.align(Alignment.TopEnd))
    }
}
