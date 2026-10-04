package com.autogram.app.ui.drive.zip

import com.autogram.app.features.cloud.preview.CloudRangeSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.Inflater

data class ZipEntryItem(
    val name: String,
    val compressedSize: Long,
    val uncompressedSize: Long,
    val isFolder: Boolean,
    val isEncrypted: Boolean,
    val compressionMethod: Int,
    val localHeaderOffset: Long
)

/**
 * Pure in-memory Sparse ZIP reader using exact MTProto Byte-Ranges.
 * Complies with AutoGram zero full-download architectural invariants.
 */
class SparseZipReader(private val source: CloudRangeSource) {

    suspend fun listEntries(): List<ZipEntryItem> = withContext(Dispatchers.IO) {
        val totalSize = source.size
        if (totalSize < 22) return@withContext emptyList()

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
        if (eocdPos < 0) return@withContext emptyList()

        val buf = ByteBuffer.wrap(tailBytes, eocdPos, tailBytes.size - eocdPos).order(ByteOrder.LITTLE_ENDIAN)
        buf.position(4) // skip 4-byte signature
        buf.short // diskNumber
        buf.short // cdStartDisk
        buf.short // totalEntriesThisDisk
        buf.short // totalEntries
        val cdSize = buf.int.toLong() and 0xFFFFFFFFL
        val cdOffset = buf.int.toLong() and 0xFFFFFFFFL

        if (cdSize <= 0 || cdOffset < 0 || cdOffset + cdSize > totalSize) return@withContext emptyList()

        // Read Central Directory slice
        val cdBytes = source.read(cdOffset, cdSize.toInt())
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
            cdBuf.int // crc
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
            val name = String(nameBytes, Charsets.UTF_8)

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
                    localHeaderOffset = localOffset
                )
            )
        }

        entries
    }

    suspend fun extractEntryBytes(entry: ZipEntryItem): ByteArray = withContext(Dispatchers.IO) {
        if (entry.isEncrypted) throw IllegalStateException("Berkas terenkripsi (ZipCrypto/AES). Masukkan kata sandi.")
        if (entry.compressedSize > 100 * 1024 * 1024) throw IllegalStateException("Ukuran berkas terlalu besar untuk diekstrak langsung ke RAM.")

        // Read Local File Header (minimum 30 bytes)
        val headerBytes = source.read(entry.localHeaderOffset, 30)
        if (headerBytes.size < 30) throw IllegalStateException("Local header rusak")
        val hBuf = ByteBuffer.wrap(headerBytes).order(ByteOrder.LITTLE_ENDIAN)
        val sig = hBuf.int
        if (sig != 0x04034b50) throw IllegalStateException("Signature local file header salah")
        hBuf.position(26)
        val localNameLen = hBuf.short.toInt() and 0xFFFF
        val localExtraLen = hBuf.short.toInt() and 0xFFFF

        val dataOffset = entry.localHeaderOffset + 30 + localNameLen + localExtraLen
        val compressedBytes = source.read(dataOffset, entry.compressedSize.toInt())

        when (entry.compressionMethod) {
            0 -> compressedBytes // Stored (no compression)
            8 -> { // Deflated
                val inflater = Inflater(true) // nowrap = true
                inflater.setInput(compressedBytes)
                val out = ByteArray(entry.uncompressedSize.toInt())
                val resultLen = inflater.inflate(out)
                inflater.end()
                if (resultLen.toLong() != entry.uncompressedSize) {
                    out.copyOf(resultLen)
                } else {
                    out
                }
            }
            else -> throw UnsupportedOperationException("Metode kompresi tidak didukung: ${entry.compressionMethod}")
        }
    }
}
