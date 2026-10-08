package com.autogram.app.features.cloud.preview

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.autogram.app.features.cloud.preview.video.*

/** Initial seek precedes preparation; playback does not wait for the forward-buffer target. */
@Composable
internal fun CloudMediaPlayer(
    source: CloudRangeSource,
    modifier: Modifier,
    scope: PlaybackScope,
    audioOnly: Boolean = false,
    onRetry: () -> Unit = {}
) {
    val controller = rememberCloudPlayback(source, scope)
    CloudPlaybackView(controller, source.size, modifier, audioOnly, onRetry)
}
