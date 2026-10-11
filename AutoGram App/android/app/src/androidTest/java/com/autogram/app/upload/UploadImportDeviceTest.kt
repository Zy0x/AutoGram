package com.autogram.app.upload

import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.features.cloud.CloudScope
import com.autogram.app.features.cloudtransfer.upload.importUpload
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Read-only generated test provider; no cloud, private files, sessions or queue mutations. */
class UploadImportDeviceTest {
    @Test fun providerWithUnknownSizeIsCopiedExactlyAndBoundToOriginalTopic() = runBlocking {
        val input = importUpload(InstrumentationRegistry.getInstrumentation().targetContext,
            Uri.parse("content://com.autogram.app.test.preview/note"), CloudScope("tg_123", "-1000000000456", 17), "fixture caption")
        val staged = File(input.stagedPath)
        try {
            assertEquals("note", input.filename)
            assertEquals("text/plain", input.mimeType)
            assertEquals(17, input.topicId)
            assertEquals("tg_123", input.accountId)
            assertEquals("fixture caption", input.caption)
            assertEquals("Actual provider content — UTF-8", staged.readText())
            assertEquals("${input.operationId}.staged", staged.name)
            assertFalse(File(staged.parentFile, "${input.operationId}.partial").exists())
        } finally { check(staged.delete()) }
    }
    @Test fun rawFilesystemUrisCannotBecomeUploadSources() = runBlocking {
        try {
            importUpload(InstrumentationRegistry.getInstrumentation().targetContext,
                Uri.parse("file:///fixture-private.txt"), CloudScope("tg_123", "me"), "")
            fail("Provider read grant required")
        } catch (_: IllegalArgumentException) { }
    }
    @Test fun invalidTopicCannotReadOrStageTheProvider() = runBlocking {
        try {
            importUpload(InstrumentationRegistry.getInstrumentation().targetContext,
                Uri.parse("content://com.autogram.app.test.preview/note"), CloudScope("tg_123", "-1000000000456", 0), "")
            fail("Explicit valid topic required")
        } catch (_: IllegalArgumentException) { }
    }
}
