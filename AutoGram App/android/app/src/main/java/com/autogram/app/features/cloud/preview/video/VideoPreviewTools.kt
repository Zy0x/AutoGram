package com.autogram.app.features.cloud.preview.video

import androidx.compose.material3.*
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.media3.common.C
import androidx.media3.common.TrackSelectionOverride
import com.autogram.app.R
import com.autogram.app.features.cloud.preview.controls.*
import java.util.Locale

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
internal fun videoPreviewTools(c: CloudPlaybackController, size: Long, audioOnly: Boolean): List<PreviewTool> {
    var help by remember(c) { mutableStateOf(false) }
    var info by remember(c) { mutableStateOf(false) }
    val speed = stringResource(R.string.video_speed_title)
    val aspect = stringResource(R.string.player_aspect)
    val aspectLabels = listOf(stringResource(R.string.video_aspect_fit), stringResource(R.string.video_aspect_fill),
        stringResource(R.string.video_aspect_16_9), stringResource(R.string.video_aspect_original))
    val loop = stringResource(if (c.looping) R.string.video_loop_enabled else R.string.video_loop_disabled)
    val mute = stringResource(R.string.player_mute)
    val rotate = stringResource(R.string.video_rotate_screen)
    val lock = stringResource(if (c.locked) R.string.player_unlock else R.string.player_lock)
    val helpLabel = stringResource(R.string.player_gesture_help)
    val infoLabel = stringResource(R.string.video_tech_info_title)
    val audioLabel = stringResource(R.string.player_audio_tracks)
    val subtitleLabel = stringResource(R.string.player_subtitle_tracks)
    val automatic = stringResource(R.string.player_track_auto)
    val off = stringResource(R.string.player_track_off)
    val trackLabel = stringResource(R.string.player_track_number)
    val tools = remember(c, c.speed, c.looping, c.locked, c.volume == 0f, c.aspectMode, c.tracks,
        audioOnly, speed, aspect, aspectLabels, loop, mute, rotate, lock, helpLabel, infoLabel, audioLabel, subtitleLabel, automatic, off, trackLabel) {
        fun trackTools(type: Int, label: String): PreviewTool {
            val groups = c.tracks.groups.filter { it.type == type }
            val choices = buildList {
                add(PreviewTool("track.$type.auto", automatic) {
                    c.player.trackSelectionParameters = c.player.trackSelectionParameters.buildUpon()
                        .clearOverridesOfType(type).setTrackTypeDisabled(type, false).build()
                })
                if (type == C.TRACK_TYPE_TEXT) add(PreviewTool("track.$type.off", off, checked = !groups.any { it.isSelected }) {
                    c.player.trackSelectionParameters = c.player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(type, true).build()
                })
                groups.forEachIndexed { groupIndex, group -> repeat(group.length) { index ->
                    val format = group.getTrackFormat(index)
                    val description = listOfNotNull(format.label, format.language?.takeIf { it != "und" }, format.sampleMimeType).distinct().joinToString(" · ")
                    add(PreviewTool("track.$type.$groupIndex.$index", description.ifBlank { String.format(trackLabel, index + 1) },
                        checked = group.isTrackSelected(index), enabled = group.isTrackSupported(index)) {
                        c.player.trackSelectionParameters = c.player.trackSelectionParameters.buildUpon()
                            .setTrackTypeDisabled(type, false).setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index)).build()
                    })
                } }
            }
            return PreviewTool("tracks.$type", label, enabled = groups.isNotEmpty(), children = choices)
        }
        buildList {
            add(PreviewTool("video.speed", speed, children = listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f, 3f, 4f).map { value ->
                PreviewTool("speed.$value", String.format(Locale.ROOT, "%sx", value), checked = c.speed == value) { c.selectSpeed(value) }
            }))
            if (!audioOnly) add(PreviewTool("video.aspect", aspect, children = VideoAspectMode.entries.mapIndexed { index, mode ->
                PreviewTool("aspect.$mode", aspectLabels[index], checked = c.aspectMode == mode) { c.aspectMode = mode }
            }))
            add(PreviewTool("video.loop", loop, checked = c.looping) { c.setLoop(!c.looping) })
            add(PreviewTool("video.mute", mute, checked = c.volume == 0f) { c.mute() })
            add(trackTools(C.TRACK_TYPE_AUDIO, audioLabel))
            if (!audioOnly) {
                add(trackTools(C.TRACK_TYPE_TEXT, subtitleLabel))
                add(PreviewTool("video.rotate", rotate) { c.rotate() })
                add(PreviewTool("video.lock", lock, checked = c.locked) {
                    c.gestureEpoch++; c.restoreBoost(); c.locked = !c.locked; c.controlsVisible = !c.locked; c.seekPreview = null
                })
                add(PreviewTool("video.help", helpLabel) { help = true })
            }
            add(PreviewTool("video.info", infoLabel) { info = true })
        }
    }
    PublishPreviewTools(tools, c.locked)
    if (help) AlertDialog(onDismissRequest = { help = false }, title = { Text(helpLabel) },
        text = { Text(stringResource(R.string.player_gesture_explanation)) },
        confirmButton = { TextButton(onClick = { help = false }) { Text(stringResource(R.string.native_close)) } })
    if (info) {
        val unknown = stringResource(R.string.player_unknown)
        val formats = listOfNotNull(c.player.videoFormat, c.player.audioFormat).map {
            listOfNotNull(it.sampleMimeType, it.codecs).joinToString(" · ")
        }.joinToString("\n").ifBlank { unknown }
        AlertDialog(onDismissRequest = { info = false }, title = { Text(infoLabel) }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!audioOnly) Text(stringResource(R.string.video_tech_resolution, if (c.width > 0) "${c.width} × ${c.height}" else unknown))
                Text(stringResource(R.string.video_tech_duration, playbackTime(c.duration)))
                Text(stringResource(R.string.video_tech_format, formats))
                Text(stringResource(R.string.video_tech_size, android.text.format.Formatter.formatShortFileSize(androidx.compose.ui.platform.LocalContext.current, size)))
            }
        }, confirmButton = { TextButton(onClick = { info = false }) { Text(stringResource(R.string.native_close)) } })
    }
    return tools
}
