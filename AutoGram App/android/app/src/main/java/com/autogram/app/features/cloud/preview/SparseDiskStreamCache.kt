package com.autogram.app.features.cloud.preview

import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Session-Scoped Sparse Disk Stream Cache.
 *
 * Persists downloaded 256KB-512KB media chunks into a temporary sparse file on disk.
 * When seeks, scrubber rewinds, or replays occur, bytes are read directly from local storage
 * in <1 ms with 0 network usage.
 * Automatically bounded to [maxDiskBytes] and cleaned up on disposal.
 */
class SparseDiskStreamCache(
    cacheDir: File,
    val totalSize: Long,
    private val maxDiskBytes: Long = DEFAULT_MAX_DISK_BYTES
) : Closeable {

    private val closed = AtomicBoolean(false)
    private val cacheFolder = File(cacheDir, "cloud_stream_cache").apply { mkdirs() }
    private val tempFile = File(cacheFolder, "stream_${UUID.randomUUID().toString().take(8)}.tmp")
    private val raf: RandomAccessFile? = try {
        RandomAccessFile(tempFile, "rw")
    } catch (_: Exception) {
        null
    }

    private val ranges = mutableListOf<Pair<Long, Long>>()
    private val lock = Any()
    private var totalCachedBytes: Long = 0L

    /**
     * Checks if the byte range [[offset], [offset] + [length]) is fully present on disk.
     */
    fun hasRange(offset: Long, length: Int): Boolean {
        if (closed.get() || raf == null || length <= 0) return false
        val end = offset + length
        synchronized(lock) {
            return ranges.any { (s, e) -> s <= offset && end <= e }
        }
    }

    /**
     * Reads [length] bytes starting at [offset] from the local sparse cache.
     * Returns null if range is not completely present.
     */
    fun readRange(offset: Long, length: Int): ByteArray? {
        if (closed.get() || raf == null || length <= 0) return null
        val end = offset + length

        synchronized(lock) {
            val covered = ranges.any { (s, e) -> s <= offset && end <= e }
            if (!covered) return null

            return try {
                raf.seek(offset)
                val buffer = ByteArray(length)
                raf.readFully(buffer)
                buffer
            } catch (_: Exception) {
                null
            }
        }
    }

    /**
     * Writes [data] at [offset] into the sparse file and merges the covered interval.
     */
    fun writeChunk(offset: Long, data: ByteArray) {
        if (closed.get() || raf == null || data.isEmpty()) return

        synchronized(lock) {
            if (totalCachedBytes + data.size > maxDiskBytes) {
                // If disk cache limit reached, stop writing to disk (memory cache still functions)
                return
            }

            try {
                raf.seek(offset)
                raf.write(data)
                totalCachedBytes += data.size
                addRange(offset, offset + data.size)
            } catch (_: Exception) {
                // Ignore write failures gracefully
            }
        }
    }

    private fun addRange(start: Long, end: Long) {
        ranges.add(start to end)
        ranges.sortBy { it.first }

        val merged = mutableListOf<Pair<Long, Long>>()
        var cur = ranges[0]

        for (i in 1 until ranges.size) {
            val next = ranges[i]
            cur = if (next.first <= cur.second) {
                cur.first to maxOf(cur.second, next.second)
            } else {
                merged.add(cur)
                next
            }
        }
        merged.add(cur)
        ranges.clear()
        ranges.addAll(merged)
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            synchronized(lock) {
                try {
                    raf?.close()
                } catch (_: Exception) {}
                try {
                    tempFile.delete()
                } catch (_: Exception) {}
                ranges.clear()
                totalCachedBytes = 0L
            }
        }
    }

    companion object {
        const val DEFAULT_MAX_DISK_BYTES = 250 * 1024 * 1024L // 250 MB session cache ceiling
    }
}
