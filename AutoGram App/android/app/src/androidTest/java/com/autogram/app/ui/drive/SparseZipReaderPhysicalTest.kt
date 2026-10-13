package com.autogram.app.ui.drive

import com.autogram.app.features.cloud.CloudFailure
import com.autogram.app.features.cloud.preview.CloudRangeSource
import com.autogram.app.ui.drive.zip.SparseZipReader
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** On-device ZIP parser checks use generated in-memory archives only; no account, file, or network access. */
class SparseZipReaderPhysicalTest {
    private fun archive(payload: ByteArray): ByteArray = ByteArrayOutputStream().also { output ->
        ZipOutputStream(output).use { zip ->
            zip.putNextEntry(ZipEntry("fixture/payload.bin").apply {
                method = ZipEntry.STORED
                size = payload.size.toLong()
                compressedSize = size
                crc = CRC32().apply { update(payload) }.value
            })
            zip.write(payload)
            zip.closeEntry()
        }
    }.toByteArray()

    private fun source(bytes: ByteArray) = CloudRangeSource(bytes.size.toLong(), { offset, length ->
        assertTrue(length <= CloudRangeSource.MAX_READ)
        bytes.copyOfRange(offset.toInt(), offset.toInt() + length)
    }, {})

    @Test fun androidRuntimeListsAndExtractsOnlyTheSelectedSparseEntry() = runBlocking {
        val payload = ByteArray(384 * 1024) { (it % 251).toByte() }
        val bytes = archive(payload)
        var fetched = 0L
        val cloud = CloudRangeSource(bytes.size.toLong(), { offset, length ->
            assertTrue(length <= CloudRangeSource.MAX_READ)
            fetched += length
            bytes.copyOfRange(offset.toInt(), offset.toInt() + length)
        }, {})
        try {
            val reader = SparseZipReader(cloud)
            val entry = reader.listEntries().single()
            assertEquals("fixture/payload.bin", entry.name)
            assertArrayEquals(payload, reader.extractEntryBytes(entry))
            assertTrue("Sparse reads must not fetch the archive twice", fetched <= bytes.size.toLong() * 2)
        } finally {
            cloud.close()
        }
    }

    @Test fun androidRuntimeRejectsASelectedEntryWithCorruptPayload() = runBlocking {
        val bytes = archive(byteArrayOf(3, 7, 11, 19))
        val nameLength = "fixture/payload.bin".length
        val entryPayloadOffset = 30 + nameLength
        bytes[entryPayloadOffset] = (bytes[entryPayloadOffset].toInt() xor 0x55).toByte()
        val cloud = source(bytes)
        try {
            val reader = SparseZipReader(cloud)
            val entry = reader.listEntries().single()
            val failure = runCatching { reader.extractEntryBytes(entry) }.exceptionOrNull()
            assertTrue(failure is CloudFailure)
            assertEquals("cloud_media_checksum_mismatch", (failure as CloudFailure).code)
        } finally {
            cloud.close()
        }
    }
}
