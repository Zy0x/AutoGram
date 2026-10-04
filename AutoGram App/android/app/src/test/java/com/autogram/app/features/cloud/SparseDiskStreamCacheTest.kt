package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.preview.SparseDiskStreamCache
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SparseDiskStreamCacheTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    @Test
    fun writeAndReadChunkMaintainsIntegrity() {
        val cacheDir = tempFolder.newFolder("stream_cache")
        val cache = SparseDiskStreamCache(cacheDir, totalSize = 10 * 1024 * 1024L, maxDiskBytes = 10 * 1024 * 1024L)

        val payload = ByteArray(256 * 1024) { (it % 256).toByte() }
        val offset = 512 * 1024L // 512 KB offset

        assertFalse("Should not have range before write", cache.hasRange(offset, payload.size))
        assertNull("Read before write should be null", cache.readRange(offset, payload.size))

        cache.writeChunk(offset, payload)

        assertTrue("Should have range after write", cache.hasRange(offset, payload.size))
        val readBack = cache.readRange(offset, payload.size)
        assertNotNull(readBack)
        assertEquals(payload.size, readBack!!.size)
        assertArrayEquals(payload, readBack)

        cache.close()
    }

    @Test
    fun contiguousWritesMergeRangesCleanly() {
        val cacheDir = tempFolder.newFolder("stream_cache_merge")
        val cache = SparseDiskStreamCache(cacheDir, totalSize = 10 * 1024 * 1024L, maxDiskBytes = 10 * 1024 * 1024L)

        val part1 = ByteArray(100) { 1 }
        val part2 = ByteArray(100) { 2 }

        cache.writeChunk(0L, part1)
        cache.writeChunk(100L, part2)

        // After writing contiguous ranges [0..100) and [100..200), we should be able to query [0..200)
        assertTrue("Merged range should cover [0..200)", cache.hasRange(0L, 200))

        val fullRead = cache.readRange(0L, 200)
        assertNotNull(fullRead)
        assertEquals(200, fullRead!!.size)
        assertEquals(1.toByte(), fullRead[0])
        assertEquals(1.toByte(), fullRead[99])
        assertEquals(2.toByte(), fullRead[100])
        assertEquals(2.toByte(), fullRead[199])

        cache.close()
    }

    @Test
    fun closeDeletesSessionFileCleanly() {
        val cacheDir = tempFolder.newFolder("stream_cache_cleanup")
        val cache = SparseDiskStreamCache(cacheDir, totalSize = 10 * 1024 * 1024L, maxDiskBytes = 10 * 1024 * 1024L)

        val payload = ByteArray(1024) { 42 }
        cache.writeChunk(0L, payload)

        val streamFolder = java.io.File(cacheDir, "cloud_stream_cache")
        val sessionFiles = streamFolder.listFiles() ?: emptyArray()
        assertTrue("Cache file should exist on disk while open", sessionFiles.isNotEmpty())

        cache.close()

        val afterCloseFiles = streamFolder.listFiles() ?: emptyArray()
        assertTrue("Cache file should be deleted on close", afterCloseFiles.isEmpty())
    }
}
