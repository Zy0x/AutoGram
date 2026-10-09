package com.autogram.app.workspace

import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.features.cloudtransfer.upload.AndroidUploadSpoolPublisher
import com.autogram.app.features.cloudtransfer.upload.UploadSpool
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File

/** Newly generated cache-directory fixtures only; no native auth, queues or cloud writes. */
class UploadSpoolDeviceTest {
    private fun fixture(action: (File) -> Unit) {
        val root = File.createTempFile("autogram-upload-spool-fixture-", "",
            InstrumentationRegistry.getInstrumentation().targetContext.cacheDir)
        check(root.delete() && root.mkdir())
        try { action(root.canonicalFile) } finally { check(root.deleteRecursively()) }
    }
    @Test fun platformPublicationFlushesExactBytesWithoutAFullFileMemoryBuffer() = fixture { root ->
        val bytes = ByteArray(130_000) { (it % 251).toByte() }
        val spool = UploadSpool(root, { 128L * 1024 * 1024 }, AndroidUploadSpoolPublisher)
        val staged = spool.import("fixture", bytes.size.toLong(), { ByteArrayInputStream(bytes) }, {})
        assertArrayEquals(bytes, staged.path.readBytes())
        assertEquals(bytes.size.toLong(), staged.bytes)
        assertFalse(root.resolve("fixture.partial").exists())
    }
    @Test fun atomicPublisherRefusesAnExistingTargetAndKeepsBothOriginals() = fixture { root ->
        val partial = root.resolve("fixture.partial").apply { writeText("source") }
        val staged = root.resolve("fixture.staged").apply { writeText("preserve") }
        try { AndroidUploadSpoolPublisher.publish(partial, staged, {}); fail("must not replace target") }
        catch (failure: android.system.ErrnoException) { assertEquals(android.system.OsConstants.EEXIST, failure.errno) }
        assertEquals("preserve", staged.readText())
        assertEquals("source", partial.readText())
    }

    @Test fun cancellationDuringPublicationDeletesOnlyItsOwnOutput() = fixture { root ->
        val partial = root.resolve("fixture.partial").apply { writeBytes(ByteArray(130_000)) }
        val other = root.resolve("other.staged").apply { writeText("preserve") }
        val staged = root.resolve("fixture.staged")
        var checks = 0
        try {
            AndroidUploadSpoolPublisher.publish(partial, staged) {
                if (++checks == 2) throw java.util.concurrent.CancellationException("fixture")
            }
            fail("must cancel publication")
        } catch (_: java.util.concurrent.CancellationException) {}
        assertFalse(staged.exists())
        assertTrue(partial.isFile)
        assertEquals("preserve", other.readText())
    }
}
