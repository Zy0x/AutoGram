package com.autogram.app.features.cloud.preview

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import com.autogram.app.features.cloud.CloudFailure
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import java.io.IOException

/** Closing a reader during a seek must not close the shared capability. Viewer owns it. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class CloudMedia3Source(private val pipeline: CloudStreamPipeline) : BaseDataSource(true) {
    constructor(source: CloudRangeSource) : this(CloudStreamPipeline(source))

    private var uri: Uri? = null
    private var position = 0L
    private var remaining = 0L
    private var opened = false

    override fun open(spec: DataSpec): Long {
        transferInitializing(spec)
        if (spec.position < 0 || spec.position > pipeline.size) throw IOException("invalid_range")
        position = spec.position
        remaining = pipeline.size - position
        if (spec.length != C.LENGTH_UNSET.toLong()) remaining = minOf(remaining, spec.length)
        uri = spec.uri
        opened = true
        pipeline.onSeek(position)
        transferStarted(spec)
        return remaining
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (remaining == 0L) return C.RESULT_END_OF_INPUT
        return try {
            val toRead = minOf(length.toLong(), remaining).toInt()
            val bytes = runBlocking(Dispatchers.IO) { pipeline.read(position, toRead) }
            if (bytes.isEmpty()) return C.RESULT_END_OF_INPUT
            bytes.copyInto(buffer, offset)
            position += bytes.size
            remaining -= bytes.size
            bytesTransferred(bytes.size)
            bytes.size
        } catch (failure: Exception) {
            throw IOException("cloud_read_failed", failure)
        }
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        if (opened) {
            opened = false
            transferEnded()
        }
        uri = null
    }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal fun cloudPlayer(context: Context, source: CloudRangeSource): ExoPlayer {
    val pipeline = CloudStreamPipeline(source)
    return ExoPlayer.Builder(context)
        .setMediaSourceFactory(ProgressiveMediaSource.Factory(DataSource.Factory { CloudMedia3Source(pipeline) })
            .setLoadErrorHandlingPolicy(object : DefaultLoadErrorHandlingPolicy() {
                override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
                    var cause: Throwable? = info.exception
                    while (cause != null && cause !is CloudFailure) cause = cause.cause
                    // Do not turn server cooldown or invalidated capabilities into a retry storm.
                    if ((cause as? CloudFailure)?.code in setOf("flood_wait", "account_changed",
                        "not_authorized", "cloud_stream_closed", "invalid_range", "cloud_media_truncated")) return C.TIME_UNSET
                    return super.getRetryDelayMsFor(info)
                }
            }))
        .setLoadControl(DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                /* minBufferMs = */ 15_000,
                /* maxBufferMs = */ 50_000,
                /* bufferForPlaybackMs = */ 150,
                /* bufferForPlaybackAfterRebufferMs = */ 500
            )
            .setPrioritizeTimeOverSizeThresholds(true)
            .build())
        .build()
}

internal fun cloudMediaItem(): MediaItem = MediaItem.fromUri("autogram-cloud://media")
