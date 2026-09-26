package com.autogram.app.features.preview

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.autogram.app.R

/** Android MediaPlayer-backed controls read actual duration/position, not UI counters. */
@Composable
internal fun NativeMediaPlayer(uri: Uri, modifier: Modifier = Modifier) {
    var failed by remember(uri) { mutableStateOf(false) }
    var player by remember(uri) { mutableStateOf<VideoView?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    Box(modifier) {
        AndroidView(factory = { context ->
            VideoView(context).apply {
                player = this
                val controls = MediaController(context)
                controls.setAnchorView(this)
                setMediaController(controls)
                setOnErrorListener { _, _, _ -> failed = true; true }
                setOnPreparedListener {
                    if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) start()
                    controls.show()
                }
                setVideoURI(uri)
            }
        }, modifier = modifier)
        if (failed) Text(stringResource(R.string.real_preview_failed))
    }
    DisposableEffect(lifecycle, player) {
        val active = player
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP) active?.pause()
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            active?.stopPlayback()
        }
    }
}
