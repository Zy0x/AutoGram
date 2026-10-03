package com.autogram.app.preview

import android.media.MediaPlayer
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.features.cloud.preview.CloudRangeSource
import com.autogram.app.features.cloud.preview.TelegramMediaDataSource
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** Real platform decoding from a virtual range fixture, never fake production media. */
class CloudRangePlaybackTest {
    @Test fun platformStartsLongAudioBeforeHighForwardBufferIsFetched() {
        val rate = 44100
        val bytesPerSecond = rate * 2
        val size = 44L + bytesPerSecond * 120
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt((size - 8).toInt()); put("WAVEfmt ".toByteArray())
            putInt(16); putShort(1); putShort(1); putInt(rate); putInt(bytesPerSecond)
            putShort(2); putShort(16); put("data".toByteArray()); putInt((size - 44).toInt())
        }.array()
        val bytesRead = AtomicLong()
        val source = CloudRangeSource(size, { offset, length ->
            bytesRead.addAndGet(length.toLong())
            ByteArray(length) { index -> if (offset + index < header.size) header[(offset + index).toInt()] else 0 }
        }, {})
        val ready = CountDownLatch(1)
        val failed = CountDownLatch(1)
        lateinit var player: MediaPlayer
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            player = MediaPlayer()
            player.setOnPreparedListener { it.start(); ready.countDown() }
            player.setOnErrorListener { _, _, _ -> failed.countDown(); true }
            player.setDataSource(TelegramMediaDataSource(source))
            player.prepareAsync()
        }
        try {
            assertTrue("actual platform preparation timed out", ready.await(10, TimeUnit.SECONDS))
            assertEquals(1L, failed.count)
            instrumentation.runOnMainSync {
                assertTrue(player.isPlaying)
                assertEquals(120000, player.duration)
            }
            assertTrue("startup fetched 40 seconds or more", bytesRead.get() < bytesPerSecond * 40L)
        } finally {
            source.close()
            instrumentation.runOnMainSync { player.release() }
        }
    }

    @Test fun mediaDataSourcePreservesUnalignedSeekAndClampsEndOfFile() {
        val source = CloudRangeSource(10000, { offset, length -> ByteArray(length) { ((offset + it) % 251).toByte() } }, {})
        val native = TelegramMediaDataSource(source)
        val output = ByteArray(64)
        assertEquals(32, native.readAt(9003, output, 5, 32))
        assertEquals((9003 % 251).toByte(), output[5])
        assertEquals(3, native.readAt(9997, output, 0, 64))
        assertEquals(-1, native.readAt(10000, output, 0, 64))
        assertEquals(0, native.readAt(0, output, 0, 0))
        native.close()
    }
}
