package com.autogram.app.ui.drive.zip

import com.autogram.app.features.cloud.preview.CloudRangeSource
import com.autogram.app.features.cloud.CloudFailure
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.Charset
import java.util.zip.CRC32
import java.util.zip.Inflater

data class ZipEntryItem(
    val name: String,
    val compressedSize: Long,
    val uncompressedSize: Long,
    val isFolder: Boolean,
    val isEncrypted: Boolean,
    val compressionMethod: Int,
    val localHeaderOffset: Long,
    val crc32: Long = 0L
)

/**
 * Pure in-memory Sparse ZIP reader using exact MTProto Byte-Ranges.
 * Complies with AutoGram zero full-download architectural invariants.
 */
class SparseZipReader(private val source: CloudRangeSource) {

    suspend fun listEntries(): List<ZipEntryItem> = withContext(Dispatchers.IO) {
        val totalSize = source.size
        if (totalSize < 22) throw IllegalArgumentException("ZIP archive is too small")

        // EOCD record is in the last 65557 bytes (22 min + 65535 max comment)
        val readLength = minOf(totalSize, 65557L).toInt()
        val readOffset = totalSize - readLength
        val tailBytes = source.read(readOffset, readLength)
        if (tailBytes.size < 22) return@withContext emptyList()

        // Find EOCD signature 0x06054b50 ("PK\x05\x06") searching from the end
        var eocdPos = -1
        for (i in tailBytes.size - 22 downTo 0) {
            if (tailBytes[i] == 0x50.toByte() &&
                tailBytes[i + 1] == 0x4b.toByte() &&
                tailBytes[i + 2] == 0x05.toByte() &&
                tailBytes[i + 3] == 0x06.toByte()
            ) {
                eocdPos = i
                break
            }
        }
        if (eocdPos < 0) throw IllegalArgumentException("ZIP end directory was not found")

        val buf = ByteBuffer.wrap(tailBytes, eocdPos, tailBytes.size - eocdPos)
            .slice().order(ByteOrder.LITTLE_ENDIAN)
        buf.position(4) // skip 4-byte signature
        val diskNumber = buf.short.toInt() and 0xFFFF
        val cdStartDisk = buf.short.toInt() and 0xFFFF
        val entriesOnDisk = buf.short.toInt() and 0xFFFF
        val totalEntries = buf.short.toInt() and 0xFFFF
        val cdSize = buf.int.toLong() and 0xFFFFFFFFL
        val cdOffset = buf.int.toLong() and 0xFFFFFFFFL
        val commentLength = buf.short.toInt() and 0xFFFF

        if (eocdPos + 22 + commentLength != tailBytes.size) {
            throw IllegalArgumentException("ZIP end directory comment length is invalid")
        }
        if (diskNumber != 0 || cdStartDisk != 0 || entriesOnDisk != totalEntries) {
            throw CloudFailure("zip_format_unsupported")
        }
        if (totalEntries == 0xFFFF || cdSize == 0xFFFFFFFFL || cdOffset == 0xFFFFFFFFL) {
            throw CloudFailure("zip_format_unsupported")
        }

        if (cdSize == 0L && totalEntries == 0) return@withContext emptyList()
        if (cdSize <= 0 || cdOffset + cdSize > totalSize) {
            throw IllegalArgumentException("ZIP central directory offsets are invalid")
        }

        // Read Central Directory slice
        val cdBytes = readExact(cdOffset, cdSize, 8 * 1024 * 1024L)
        val cdBuf = ByteBuffer.wrap(cdBytes).order(ByteOrder.LITTLE_ENDIAN)

        val entries = mutableListOf<ZipEntryItem>()
        while (cdBuf.remaining() >= 46) {
            val sig = cdBuf.int
            if (sig != 0x02014b50) break // not Central Directory Header signature

            cdBuf.short // versionMadeBy
            cdBuf.short // versionNeeded
            val flags = cdBuf.short.toInt() and 0xFFFF
            val isEncrypted = (flags and 0x0001) != 0
            val compression = cdBuf.short.toInt() and 0xFFFF
            cdBuf.short // modTime
            cdBuf.short // modDate
            val crc32 = cdBuf.int.toLong() and 0xFFFFFFFFL
            val compressedSize = cdBuf.int.toLong() and 0xFFFFFFFFL
            val uncompressedSize = cdBuf.int.toLong() and 0xFFFFFFFFL
            val nameLen = cdBuf.short.toInt() and 0xFFFF
            val extraLen = cdBuf.short.toInt() and 0xFFFF
            val commentLen = cdBuf.short.toInt() and 0xFFFF
            cdBuf.short // diskStart
            cdBuf.short // internalAttr
            val externalAttr = cdBuf.int
            val localOffset = cdBuf.int.toLong() and 0xFFFFFFFFL

            if (cdBuf.remaining() < nameLen + extraLen + commentLen) break

            val nameBytes = ByteArray(nameLen)
            cdBuf.get(nameBytes)
            val charset = if ((flags and (1 shl 11)) != 0) Charsets.UTF_8 else Charset.forName("IBM437")
            val name = String(nameBytes, charset)

            cdBuf.position(cdBuf.position() + extraLen + commentLen)

            val isFolder = name.endsWith("/") || (externalAttr and 0x10) != 0

            entries.add(
                ZipEntryItem(
                    name = name,
                    compressedSize = compressedSize,
                    uncompressedSize = uncompressedSize,
                    isFolder = isFolder,
                    isEncrypted = isEncrypted,
                    compressionMethod = compression,
                    localHeaderOffset = localOffset,
                    crc32 = crc32
                )
            )
        }

        if (entries.size != totalEntries) {
            throw CloudFailure("zip_invalid_archive")
        }

        entries
    }

    suspend fun extractEntryBytes(entry: ZipEntryItem): ByteArray = withContext(Dispatchers.IO) {
        if (entry.isEncrypted) throw CloudFailure("zip_format_unsupported")
        if (entry.compressedSize > 100 * 1024 * 1024) throw CloudFailure("zip_format_unsupported")
        if (entry.uncompressedSize !in 0..100 * 1024 * 1024L) throw CloudFailure("cloud_format_unsupported")

        // Read Local File Header (minimum 30 bytes)
        val headerBytes = source.read(entry.localHeaderOffset, 30)
        if (headerBytes.size < 30) throw CloudFailure("zip_invalid_archive")
        val hBuf = ByteBuffer.wrap(headerBytes).order(ByteOrder.LITTLE_ENDIAN)
        val sig = hBuf.int
        if (sig != 0x04034b50) throw CloudFailure("zip_invalid_archive")
        hBuf.short // version needed
        val localFlags = hBuf.short.toInt() and 0xFFFF
        val localMethod = hBuf.short.toInt() and 0xFFFF
        if ((localFlags and 1 != 0) != entry.isEncrypted || localMethod != entry.compressionMethod) {
            throw CloudFailure("zip_invalid_archive")
        }
        hBuf.position(26)
        val localNameLen = hBuf.short.toInt() and 0xFFFF
        val localExtraLen = hBuf.short.toInt() and 0xFFFF
        if (localNameLen > source.size - entry.localHeaderOffset - 30) {
            throw CloudFailure("invalid_range")
        }
        val localName = source.read(entry.localHeaderOffset + 30, localNameLen)
        val centralName = entry.name.toByteArray(if ((localFlags and (1 shl 11)) != 0) Charsets.UTF_8 else Charset.forName("IBM437"))
        if (!localName.contentEquals(centralName)) throw CloudFailure("zip_invalid_archive")

        val dataOffset = entry.localHeaderOffset + 30 + localNameLen + localExtraLen
        if (dataOffset < entry.localHeaderOffset || dataOffset > source.size) throw CloudFailure("invalid_range")
        val compressedBytes = readExact(dataOffset, entry.compressedSize, 100 * 1024 * 1024L)

        val result = when (entry.compressionMethod) {
            0 -> {
                if (compressedBytes.size.toLong() != entry.uncompressedSize) throw CloudFailure("cloud_media_truncated")
                compressedBytes // Stored (no compression)
            }
            8 -> { // Deflated
                val inflater = Inflater(true) // nowrap = true
                try {
                    inflater.setInput(compressedBytes)
                    // Even empty deflate entries need output capacity to consume the terminator.
                    val out = ByteArray(maxOf(1, entry.uncompressedSize.toInt()))
                    val resultLen = inflater.inflate(out)
                    if (resultLen.toLong() != entry.uncompressedSize || !inflater.finished()) {
                        throw CloudFailure("cloud_media_truncated")
                    }
                    if (entry.uncompressedSize == 0L) ByteArray(0) else out
                } finally {
                    inflater.end()
                }
            }
            else -> throw CloudFailure("zip_format_unsupported")
        }
        val crc = CRC32().apply { update(result) }.value
        if (crc != entry.crc32) throw CloudFailure("cloud_media_checksum_mismatch")
        result
    }

    /** CloudRangeSource intentionally caps each call; consume only the declared slice. */
    private suspend fun readExact(offset: Long, length: Long, limit: Long): ByteArray {
        if (offset < 0 || length < 0 || length > limit || length > source.size - offset) {
            throw CloudFailure("invalid_range")
        }
        val output = ByteArray(length.toInt())
        var copied = 0
        while (copied < output.size) {
            currentCoroutineContext().ensureActive()
            val chunk = source.read(offset + copied, output.size - copied)
            if (chunk.isEmpty()) throw CloudFailure("cloud_media_truncated")
            chunk.copyInto(output, copied)
            copied += chunk.size
        }
        return output
    }
}
