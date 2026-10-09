package com.autogram.app.features.cloudtransfer

import com.autogram.app.features.cloud.CloudScope
import com.autogram.app.features.cloudtransfer.domain.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class BatchDownloadTest {
    private val scope = CloudScope("fixture-account", "fixture-peer", 17)
    private fun item(id: Int) = BatchDownloadItem(id.toString(), scope.accountId,
        scope.peerId, scope.topicId, id, "fixture-$id", "text/plain")

    @Test fun onlyAcknowledgedJobsCountAndFailuresRemainSelected() = runBlocking {
        val remembered = mutableListOf<String>()
        val result = enqueueDownloadBatch(scope, listOf(item(1), item(2), item(3)),
            { if (it.message == 2) error("fixture-rejected") else "op-${it.id}" },
            { source, _ -> remembered.add(source.id) }, { true })
        assertEquals(setOf("1", "3"), result.queued)
        assertEquals(setOf("2"), result.failed)
        assertEquals(listOf("1", "3"), remembered)
    }
    @Test fun foreignAccountPeerTopicAndInvalidMessagesNeverEnqueue() = runBlocking {
        val invalid = listOf(item(1).copy(account = "foreign"), item(2).copy(peer = "foreign"),
            item(3).copy(topic = 18), item(4).copy(message = 0), item(5).copy(message = null))
        val result = enqueueDownloadBatch(scope, invalid, { error("must not dispatch") },
            { _, _ -> error("must not remember") }, { true })
        assertTrue(result.queued.isEmpty()); assertEquals(invalid.map { it.id }.toSet(), result.failed)
    }
    @Test fun duplicateSelectionsAreNotDispatchedTwiceAndTopicIsPreserved() = runBlocking {
        var calls = 0
        val result = enqueueDownloadBatch(scope, listOf(item(1), item(1)),
            { calls++; assertEquals(17L, it.topic); "op" }, { _, _ -> }, { true })
        assertEquals(1, calls); assertEquals(setOf("1"), result.queued)
    }
    @Test fun metadataFailureCannotCauseFalseFailureOrDuplicateEnqueue() = runBlocking {
        var calls = 0
        val result = enqueueDownloadBatch(scope, listOf(item(1)), { calls++; "op" },
            { _, _ -> error("metadata unavailable") }, { true })
        assertEquals(1, calls); assertEquals(setOf("1"), result.queued); assertTrue(result.failed.isEmpty())
    }
    @Test fun emptyAcknowledgementIsAFailure() = runBlocking {
        val result = enqueueDownloadBatch(scope, listOf(item(1)), { "" }, { _, _ -> fail() }, { true })
        assertTrue(result.queued.isEmpty()); assertEquals(setOf("1"), result.failed)
    }
    @Test fun unavailableNativeLibraryIsAnEnqueueFailure() = runBlocking {
        val result = enqueueDownloadBatch(scope, listOf(item(1)), { throw UnsatisfiedLinkError() },
            { _, _ -> fail() }, { true })
        assertTrue(result.queued.isEmpty()); assertEquals(setOf("1"), result.failed)
    }
    @Test fun cancellationNeverContinuesTheBatchOrReturnsASuccess() = runBlocking {
        var calls = 0
        try {
            enqueueDownloadBatch(scope, listOf(item(1), item(2)),
                { calls++; throw CancellationException("fixture-cancel") }, { _, _ -> fail() }, { true })
            fail("Cancellation must propagate")
        } catch (_: CancellationException) { assertEquals(1, calls) }
    }
    @Test fun scopeChangeAfterAwaitRejectsLateMetadataAndRemainingItems() = runBlocking {
        var current = true
        var calls = 0
        try {
            enqueueDownloadBatch(scope, listOf(item(1), item(2)),
                { calls++; current = false; "op" }, { _, _ -> fail() }, { current })
            fail("Stale result must not publish")
        } catch (_: CancellationException) { assertEquals(1, calls) }
    }
    @Test fun staleRequestAndInvalidTopicDoNotDispatch() = runBlocking {
        try {
            enqueueDownloadBatch(scope, listOf(item(1)), { fail(); "op" }, { _, _ -> fail() }, { false })
            fail("Stale request must cancel")
        } catch (_: CancellationException) { }
        val invalidScope = scope.copy(topicId = Int.MAX_VALUE.toLong() + 1)
        val result = enqueueDownloadBatch(invalidScope, listOf(item(1).copy(topic = invalidScope.topicId)),
            { fail(); "op" }, { _, _ -> fail() }, { true })
        assertEquals(setOf("1"), result.failed)
    }
}
