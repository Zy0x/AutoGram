package com.autogram.app.preview

import android.net.Uri
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import androidx.media3.datasource.DataSpec
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.features.cloud.preview.*
import kotlinx.coroutines.delay
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** The production player/adapter with bounded network-latency fixtures, never production substitutes. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class CloudRangePlaybackTest {
    @Test fun platformStartsLongAudioBeforeHighForwardBufferIsFetched() = playback(0)
    @Test fun storedPositionSeeksBeforePlayWithoutFillingFromBeginning() = playback(90000)

    private fun playback(start: Long) {
        val bytesPerSecond = 44100 * 2
        val size = 44L + bytesPerSecond * 120
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt((size - 8).toInt()); put("WAVEfmt ".toByteArray())
            putInt(16); putShort(1); putShort(1); putInt(44100); putInt(bytesPerSecond)
            putShort(2); putShort(16); put("data".toByteArray()); putInt((size - 44).toInt())
        }.array()
        val bytesRead = AtomicLong()
        val prefixBytes = AtomicLong()
        val furthestOffset = AtomicLong()
        val atPlay = AtomicLong()
        val source = CloudRangeSource(size, { offset, length ->
            delay(5) // Controlled nonzero transport latency, not a RAM-speed network.
            bytesRead.addAndGet(length.toLong())
            if (offset < bytesPerSecond * 85L) prefixBytes.addAndGet(length.toLong())
            furthestOffset.updateAndGet { maxOf(it, offset) }
            ByteArray(length) { index -> if (offset + index < header.size) header[(offset + index).toInt()] else 0 }
        }, {})
        val started = CountDownLatch(1)
        val failed = CountDownLatch(1)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        lateinit var player: ExoPlayer
        instrumentation.runOnMainSync {
            player = cloudPlayer(instrumentation.targetContext, source)
            player.volume = 0f // Test-owned player only; never change the phone volume.
            player.addListener(object : Player.Listener {
                override fun onIsPlayingChanged(playing: Boolean) {
                    if (playing) { atPlay.compareAndSet(0, bytesRead.get()); started.countDown() }
                }
                override fun onPlayerError(error: PlaybackException) { failed.countDown() }
            })
            player.setMediaItem(cloudMediaItem(), start)
            player.playWhenReady = true; player.prepare()
        }
        try {
            assertTrue("production player start timed out", started.await(10, TimeUnit.SECONDS))
            assertEquals(1L, failed.count)
            instrumentation.runOnMainSync {
                assertTrue(player.isPlaying); assertEquals(120000L, player.duration)
                assertTrue("did not start at requested position", player.currentPosition >= start - 1000)
            }
            assertTrue("startup required 40 seconds of bytes", atPlay.get() < bytesPerSecond * 40L)
            if (start > 0) {
                assertTrue("seek did not read destination", furthestOffset.get() >= bytesPerSecond * 85L)
                assertTrue("resume filled file prefix instead of just parsing headers", prefixBytes.get() < 512 * 1024)
            }
            instrumentation.sendStatus(0, android.os.Bundle().apply {
                putString("stream", "preview-fixture start-ms=$start bytes-at-play=${atPlay.get()}\n")
            })
        } finally {
            source.close(); instrumentation.runOnMainSync { player.release() }
        }
    }

    @Test fun rangeReaderSeeksExactlyAndReaderCloseDoesNotDestroyCapability() {
        val source = CloudRangeSource(10000, { offset, length -> ByteArray(length) { ((offset + it) % 251).toByte() } }, {})
        val native = CloudMedia3Source(source)
        val output = ByteArray(64)
        native.open(DataSpec.Builder().setUri(Uri.parse("autogram-cloud://fixture")).setPosition(9003).build())
        assertEquals(32, native.read(output, 5, 32))
        assertEquals((9003 % 251).toByte(), output[5]); native.close()
        native.open(DataSpec.Builder().setUri(Uri.parse("autogram-cloud://fixture")).setPosition(9997).build())
        assertEquals(3, native.read(output, 0, 64))
        assertEquals(-1, native.read(output, 0, 64)); assertEquals(0, native.read(output, 0, 0))
        native.close(); source.close()
    }
}
