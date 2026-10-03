package com.autogram.app.features.cloud.preview

import android.media.MediaDataSource
import android.media.MediaPlayer
import android.os.Build
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.widget.MediaController
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.autogram.app.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import java.io.IOException

internal class TelegramMediaDataSource(private val source: CloudRangeSource) : MediaDataSource() {
    override fun getSize() = source.size
    override fun close() = source.close()
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (position < 0 || offset < 0 || size < 0 || offset > buffer.size - size) throw IOException("invalid_range")
        if (size == 0) return 0
        if (position >= source.size) return -1
        return try {
            val bytes = runBlocking(Dispatchers.IO) { source.read(position, size) }
            bytes.copyInto(buffer, offset)
            bytes.size
        } catch (_: Exception) { throw IOException("cloud_read_failed") }
    }
}

/** Preparation, duration and seek all come from MediaPlayer. No high startup-buffer target. */
@Composable
internal fun CloudMediaPlayer(source: CloudRangeSource, modifier: Modifier, scope: PlaybackScope) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
    val preferences = remember(context) { AndroidPlaybackPreferences(context) }
    val history = remember(preferences) { PlaybackHistory(preferences) }
    var failed by remember(source) { mutableStateOf(false) }
    var prepared by remember(source) { mutableStateOf(false) }
    var completed by remember(source) { mutableStateOf(false) }
    val player = remember(source) { MediaPlayer() }
    var controller by remember(source) { mutableStateOf<MediaController?>(null) }
    fun savePosition() {
        if (prepared && !completed && preferences.rememberPosition) runCatching { history.save(scope, player.currentPosition.toLong()) }
    }
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (prepared && (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP)) {
                savePosition(); player.pause()
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            controller?.hide()
            savePosition()
            // Cancel the native RPC before releasing the player waiting on readAt.
            runCatching { source.close() }
            runCatching { player.release() }
        }
    }
    Box(modifier) {
        AndroidView(modifier = modifier, factory = { context ->
            SurfaceView(context).apply {
                val surface = this
                var initialized = false
                val controls = MediaController(context)
                controller = controls
                controls.setAnchorView(surface)
                controls.setMediaPlayer(object : MediaController.MediaPlayerControl {
                    override fun start() { if (prepared) { completed = false; player.start() } }
                    override fun pause() { if (prepared) player.pause() }
                    override fun getDuration() = if (prepared) player.duration else 0
                    override fun getCurrentPosition() = if (prepared) player.currentPosition else 0
                    override fun seekTo(pos: Int) { if (prepared) { completed = false; player.seekTo(pos.coerceAtLeast(0)) } }
                    override fun isPlaying() = prepared && player.isPlaying
                    override fun getBufferPercentage() = 0 // MediaDataSource does not report forward-buffer coverage.
                    override fun canPause() = prepared
                    override fun canSeekBackward() = prepared
                    override fun canSeekForward() = prepared
                    override fun getAudioSessionId() = player.audioSessionId
                })
                setOnClickListener { if (prepared) controls.show() }
                player.setOnErrorListener { _, _, _ -> failed = true; prepared = false; true }
                player.setOnCompletionListener { completed = true; history.clear(scope) }
                player.setOnPreparedListener {
                    prepared = true
                    val position = if (preferences.rememberPosition) history.position(scope) else 0
                    if (position in 1 until (it.duration - 1000).toLong()) {
                        it.setOnSeekCompleteListener { sought ->
                            sought.setOnSeekCompleteListener(null)
                            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) sought.start()
                        }
                        // Seek before play; readAt goes straight to the requested byte offset.
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            it.seekTo(position, MediaPlayer.SEEK_CLOSEST)
                        } else {
                            @Suppress("DEPRECATION")
                            it.seekTo(position.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
                        }
                    } else if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) it.start()
                    controls.show()
                }
                holder.addCallback(object : SurfaceHolder.Callback {
                    override fun surfaceCreated(holder: SurfaceHolder) {
                        runCatching {
                            player.setDisplay(holder)
                            if (!initialized) {
                                initialized = true
                                player.setDataSource(TelegramMediaDataSource(source))
                                player.prepareAsync()
                            }
                        }.onFailure { failed = true }
                    }
                    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit
                    override fun surfaceDestroyed(holder: SurfaceHolder) {
                        runCatching { if (prepared) player.pause(); player.setDisplay(null) }
                    }
                })
            }
        })
        if (!prepared && !failed) Text(stringResource(R.string.cloud_preview_loading))
        if (failed) Text(stringResource(R.string.cloud_format_unsupported))
    }
}
