package com.autogram.app.features.cloudtransfer.upload

import com.autogram.app.features.cloud.CloudScope
import org.junit.Assert.*
import org.junit.Test
import uniffi.autogram_android_bridge.*

class UploadQueueContractTest {
    private val input = NativeUploadInput("fixture", "tg_123", "-1000000000456", 17,
        "/fixture.staged", "fixture.bin", "application/octet-stream", "")
    private fun record() = NativeCloudUpload("fixture", "tg_123", "-1000000000456", 17,
        "fixture.bin", "queued", 100uL, 0uL, null, null, null, null)

    @Test fun acknowledgedQueueMustRetainAccountDestinationTopicAndOperation() {
        validateAdmission(input, NativeUploadAdmission.Queued(record()))
        listOf(record().copy(accountId = "tg_999"), record().copy(peerId = "-1000000000789"),
            record().copy(topicId = 18), record().copy(operationId = "other"), record().copy(filename = "other.bin"))
            .forEach { bad ->
                try { validateAdmission(input, NativeUploadAdmission.Queued(bad)); fail("Foreign acknowledgement") }
                catch (_: IllegalStateException) { }
            }
    }
    @Test fun savedMessagesUsesVerifiedUserDialogIdentity() {
        val saved = record().copy(peerId = "123", topicId = null)
        assertTrue(saved.belongsTo(CloudScope("tg_123", "me")))
        validateAdmission(input.copy(peerId = "me", topicId = null), NativeUploadAdmission.Queued(saved))
        assertFalse(saved.belongsTo(CloudScope("tg_123", "me", 17)))
    }
    @Test fun reusedDocumentMustCarryARealMessageInTheExactScope() {
        val receipt = NativeReusedCloudUpload("fixture", "tg_123", "-1000000000456", 17,
            1234, 456, "fixture.bin", 100uL, 123456L)
        validateAdmission(input, NativeUploadAdmission.Reused(receipt))
        try { validateAdmission(input, NativeUploadAdmission.Reused(receipt.copy(messageId = 0))); fail("No message") }
        catch (_: IllegalStateException) { }
    }
    @Test fun documentProfileDoesNotChangePresentationOrEnableAlbumsOrAccountSwitching() {
        val settings = documentSettings("fixture")
        assertEquals(NativePresentationMode.FORCE_DOCUMENT, settings.presentation)
        assertEquals(NativeQualityMode.DOCUMENT, settings.qualityMode)
        assertEquals(NativeAlbumPacking.NEVER, settings.albumPacking)
        assertFalse(settings.groupAsAlbum)
        assertEquals(NativeEncoderStrategy.DISABLE_REENCODE, settings.encoder.strategy)
    }
}
