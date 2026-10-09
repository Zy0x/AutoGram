package com.autogram.app.features.cloudtransfer.upload

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.util.concurrent.CancellationException

class UploadSpoolTest {
    @get:Rule val temp = TemporaryFolder()
    private fun spool(budget: Long = 128L * 1024 * 1024) = UploadSpool(temp.root.canonicalFile, { budget },
        UploadSpoolPublisher { partial, staged, _ ->
            // Host fixture storage may be exFAT. Android's exclusive publisher has
            // separate device coverage; this host publisher also refuses replacement.
            java.nio.file.Files.move(partial.toPath(), staged.toPath())
        })
    private fun rejected(code: String, action: () -> Unit) {
        try { action(); fail("expected $code") }
        catch (failure: UploadSpoolFailure) { assertEquals(code, failure.code) }
    }
    @Test fun importedBytesAreFlushedAndPublishedUnderOperationIdentity() {
        val bytes = ByteArray(130_000) { (it % 251).toByte() }
        val result = spool().import("fixture-operation", bytes.size.toLong(), { ByteArrayInputStream(bytes) }, {})
        assertArrayEquals(bytes, result.path.readBytes())
        assertEquals(bytes.size.toLong(), result.bytes)
        assertEquals("fixture-operation.staged", result.path.name)
        assertFalse(temp.root.resolve("fixture-operation.partial").exists())
    }
    @Test fun existingStagedAndPartialFilesAreNeverOverwrittenOrDeleted() {
        val existing = temp.root.resolve("existing.staged").apply { writeText("preserve") }
        rejected("operation_conflict") { spool().import("existing", 1, { ByteArrayInputStream(byteArrayOf(1)) }, {}) }
        assertEquals("preserve", existing.readText())
        val partial = temp.root.resolve("inflight.partial").apply { writeText("owned by another invocation") }
        rejected("operation_conflict") { spool().import("inflight", 1, { ByteArrayInputStream(byteArrayOf(1)) }, {}) }
        assertEquals("owned by another invocation", partial.readText())
    }
    @Test fun cancellationRemovesOnlyTheNewPartialAndNeverPublishesOutput() {
        val unrelated = temp.root.resolve("other.staged").apply { writeText("preserve") }
        var checks = 0
        try {
            spool().import("cancelled", null, { ByteArrayInputStream(ByteArray(130_000)) }) {
                if (++checks == 3) throw CancellationException("fixture")
            }
            fail("cancellation expected")
        } catch (_: CancellationException) {}
        assertFalse(temp.root.resolve("cancelled.partial").exists())
        assertFalse(temp.root.resolve("cancelled.staged").exists())
        assertEquals("preserve", unrelated.readText())
    }
    @Test fun unknownLengthCannotExceedAvailableBudgetAndFalseProviderSizeIsRejected() {
        rejected("insufficient_storage") { spool(64L * 1024 * 1024 + 10).import("large", null,
            { ByteArrayInputStream(ByteArray(11)) }, {}) }
        assertFalse(temp.root.resolve("large.partial").exists())
        rejected("source_size_changed") { spool().import("mismatch", 2,
            { ByteArrayInputStream(byteArrayOf(1)) }, {}) }
        assertFalse(temp.root.resolve("mismatch.staged").exists())
    }
    @Test fun insufficientSpaceAndInvalidIdsNeverOpenTheProvider() {
        rejected("insufficient_storage") { spool(1).import("fixture", 1, { error("must not open") }, {}) }
        rejected("invalid_request") { spool().import("../escape", 1, { error("must not open") }, {}) }
        assertTrue(temp.root.listFiles()!!.isEmpty())
    }
    @Test fun inputFailureCannotBeMistakenForAStagedFile() {
        try { spool().import("broken", null, { throw java.io.IOException("fixture source failure") }, {}); fail("failure expected") }
        catch (_: java.io.IOException) {}
        assertTrue(temp.root.listFiles()!!.isEmpty())
    }
    @Test fun targetCreatedDuringImportIsNeverReplacedByPublication() {
        val staged = temp.root.resolve("raced.staged")
        try {
            spool().import("raced", 1, {
                staged.writeText("preserve")
                ByteArrayInputStream(byteArrayOf(1))
            }, {})
            fail("publication must refuse existing target")
        } catch (_: java.nio.file.FileAlreadyExistsException) {}
        assertEquals("preserve", staged.readText())
        assertFalse(temp.root.resolve("raced.partial").exists())
    }
}
