package com.autogram.app.ui.drive

import com.autogram.app.features.cloud.preview.CloudRangeSource
import com.autogram.app.ui.drive.zip.SparseZipReader
import com.autogram.app.ui.drive.zip.ZipEntryItem
import java.io.ByteArrayOutputStream
import java.util.Random
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class SparseZipReaderTest {
    private fun archive(payload: ByteArray, stored: Boolean = true): ByteArray = ByteArrayOutputStream().also { output ->
        ZipOutputStream(output).use { zip ->
            zip.putNextEntry(ZipEntry("payload.bin").apply {
                if (stored) {
                    method = ZipEntry.STORED
                    size = payload.size.toLong()
                    compressedSize = size
                    crc = CRC32().apply { update(payload) }.value
                }
            })
            zip.write(payload)
            zip.closeEntry()
        }
    }.toByteArray()

    @Test fun catalogReadsEocdRelativeToItsPositionInsideTheTail() = runBlocking {
        val bytes = archive(byteArrayOf(1, 2, 3))
        val source = CloudRangeSource(bytes.size.toLong(), { offset, length ->
            bytes.copyOfRange(offset.toInt(), offset.toInt() + length)
        }, {})
        try {
            val entries = SparseZipReader(source).listEntries()
            assertEquals(1, entries.size)
            assertEquals("payload.bin", entries.single().name)
            assertEquals(3L, entries.single().uncompressedSize)
        } finally { source.close() }
    }

    @Test fun payloadLargerThanOneRangeIsNotSilentlyTruncated() = runBlocking {
        val payload = ByteArray(700_000).apply { Random(7).nextBytes(this) }
        val bytes = archive(payload)
        var fetched = 0
        val source = CloudRangeSource(bytes.size.toLong(), { offset, length ->
            assertTrue(length <= CloudRangeSource.MAX_READ)
            fetched += length
            bytes.copyOfRange(offset.toInt(), offset.toInt() + length)
        }, {})
        try {
            val entry = ZipEntryItem("payload.bin", payload.size.toLong(), payload.size.toLong(),
                false, false, ZipEntry.STORED, 0)
            assertArrayEquals(payload, SparseZipReader(source).extractEntryBytes(entry))
            assertEquals(payload.size + 30, fetched)
        } finally { source.close() }
    }

    @Test fun largeCentralDirectoryReadsAllEntriesWithoutScanningTheArchive() = runBlocking {
        val output = ByteArrayOutputStream()
        ZipOutputStream(output).use { zip ->
            repeat(6000) { index ->
                zip.putNextEntry(ZipEntry("folder/entry-$index.txt"))
                zip.closeEntry()
            }
        }
        val bytes = output.toByteArray()
        var fetched = 0
        val source = CloudRangeSource(bytes.size.toLong(), { offset, length ->
            assertTrue(length <= CloudRangeSource.MAX_READ)
            fetched += length
            bytes.copyOfRange(offset.toInt(), offset.toInt() + length)
        }, {})
        try {
            val entries = SparseZipReader(source).listEntries()
            assertEquals(6000, entries.size)
            assertEquals("folder/entry-5999.txt", entries.last().name)
            assertTrue("Only tail and declared directory may be fetched", fetched < bytes.size)
        } finally { source.close() }
    }

    @Test fun deflatedEntriesIncludeEmptyFilesAndRejectIncompleteOutput() = runBlocking {
        for (payload in listOf(ByteArray(0), ByteArray(400_000).apply { Random(9).nextBytes(this) })) {
            val bytes = archive(payload, stored = false)
            val source = CloudRangeSource(bytes.size.toLong(), { offset, length ->
                bytes.copyOfRange(offset.toInt(), offset.toInt() + length)
            }, {})
            try {
                val reader = SparseZipReader(source)
                val entry = reader.listEntries().single()
                assertArrayEquals(payload, reader.extractEntryBytes(entry))
                val failure = runCatching {
                    reader.extractEntryBytes(entry.copy(uncompressedSize = entry.uncompressedSize + 1))
                }.exceptionOrNull()
                assertTrue(failure is com.autogram.app.features.cloud.CloudFailure)
                assertEquals("cloud_media_truncated", (failure as com.autogram.app.features.cloud.CloudFailure).code)
            } finally { source.close() }
        }
    }
}
