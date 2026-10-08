package com.autogram.app.preview

import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.features.cloud.CloudFailure
import com.autogram.app.features.cloud.preview.CloudRangeSource
import com.autogram.app.features.cloud.preview.image.decodeCloudImage
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Synthetic 21.6MB BMP ranges, no file chooser/accounts/cloud requests/private content. */
class CloudImageDecodeTest {
    @Test fun imageAboveOld20MiBLimitDecodesWithoutFullEncodedRamBufferAndDeletesSpool() = runBlocking {
        val directory = File.createTempFile("autogram-decode-test-", "", InstrumentationRegistry.getInstrumentation().targetContext.cacheDir)
        check(directory.delete() && directory.mkdir())
        val size = 54L + 3000 * 2400 * 3
        val header = ByteBuffer.allocate(54).order(ByteOrder.LITTLE_ENDIAN).apply {
            put('B'.code.toByte()); put('M'.code.toByte()); putInt(size.toInt()); putInt(0); putInt(54)
            putInt(40); putInt(3000); putInt(2400); putShort(1); putShort(24); putInt(0)
            putInt((size - 54).toInt()); putInt(0); putInt(0); putInt(0); putInt(0)
        }.array()
        var bytesRead = 0L
        val source = CloudRangeSource(size, { offset, length ->
            assertTrue(length <= CloudRangeSource.MAX_READ)
            bytesRead += length
            ByteArray(length).also { if (offset < header.size) header.copyInto(it, 0, offset.toInt(), minOf(header.size, offset.toInt() + length)) }
        }, {})
        try {
            val bitmap = decodeCloudImage(source, directory)
            assertEquals(3000, bitmap.width); assertEquals(2400, bitmap.height)
            assertEquals(size, bytesRead); assertTrue(bitmap.allocationByteCount <= 32 * 1024 * 1024)
            bitmap.recycle()
            assertTrue(directory.listFiles()!!.isEmpty())
        } finally { source.close(); directory.delete() }
    }
    @Test fun corruptDecodeStillDeletesSpool() = runBlocking {
        val directory = File.createTempFile("autogram-decode-test-", "", InstrumentationRegistry.getInstrumentation().targetContext.cacheDir)
        check(directory.delete() && directory.mkdir())
        val source = CloudRangeSource(2048, { _, length -> ByteArray(length) }, {})
        try {
            try { decodeCloudImage(source, directory); fail("Corrupt bytes must fail") }
            catch (failure: CloudFailure) { assertEquals("cloud_format_unsupported", failure.code) }
            assertTrue(directory.listFiles()!!.isEmpty())
        } finally { source.close(); directory.delete() }
    }
}
