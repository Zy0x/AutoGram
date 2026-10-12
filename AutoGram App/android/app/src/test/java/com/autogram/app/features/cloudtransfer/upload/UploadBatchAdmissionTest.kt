package com.autogram.app.features.cloudtransfer.upload

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test

class UploadBatchAdmissionTest {
    @Test fun reportsQueuedAndReusedCountsWithoutInventingUploadProgress() = runBlocking {
        val progress = mutableListOf<Pair<Int, Int>>()
        var call = 0
        val summary = enqueueUploadBatch(4, admit = {
            when (call++) {
                0, 2 -> UploadAdmissionOutcome.QUEUED
                else -> UploadAdmissionOutcome.REUSED
            }
        }, onProgress = { current, total -> progress += current to total })

        assertEquals(4, summary.total)
        assertEquals(2, summary.queued)
        assertEquals(2, summary.reused)
        assertEquals(4, summary.accepted)
        assertEquals(listOf(1 to 4, 2 to 4, 3 to 4, 4 to 4), progress)
    }

    @Test fun preservesPartialAcceptanceCountsWhenALaterAdmissionFails() = runBlocking {
        var call = 0
        val failure = try {
            enqueueUploadBatch(3, admit = {
                when (call++) {
                    0 -> UploadAdmissionOutcome.QUEUED
                    1 -> UploadAdmissionOutcome.REUSED
                    else -> error("queue unavailable")
                }
            })
            fail("Expected an explicit partial-admission result")
            return@runBlocking
        } catch (error: PartialUploadBatchFailure) {
            error
        }
        assertEquals(3, failure.summary.total)
        assertEquals(1, failure.summary.queued)
        assertEquals(1, failure.summary.reused)
        assertEquals(2, failure.summary.accepted)
        assertEquals("queue unavailable", failure.cause?.message)
    }

    @Test fun cancellationIsPropagatedAndNeverConvertedIntoPartialSuccess() = runBlocking {
        var call = 0
        var cancelledSummary: UploadBatchSummary? = null
        var cancellationCallbacks = 0
        val failure = try {
            withContext(NonCancellable) {
                enqueueUploadBatch(
                    total = 2,
                    admit = {
                        if (call++ == 0) UploadAdmissionOutcome.QUEUED
                        else throw CancellationException("cancelled")
                    },
                    onCancelled = { cancelledSummary = it; cancellationCallbacks++ }
                )
            }
            fail("Cancellation must propagate")
            return@runBlocking
        } catch (error: CancellationException) {
            error
        }
        assertEquals("cancelled", failure.message)
        assertEquals(2, cancelledSummary?.total)
        assertEquals(1, cancelledSummary?.queued)
        assertEquals(1, cancelledSummary?.accepted)
        assertEquals(1, cancellationCallbacks)
    }

    @Test fun emptyBatchIsRejectedBeforeStartingAdmission() = runBlocking {
        var called = false
        try {
            enqueueUploadBatch(0, admit = { called = true; UploadAdmissionOutcome.QUEUED })
            fail("Expected empty selection rejection")
        } catch (_: IllegalArgumentException) {
        }
        assertEquals(false, called)
    }
}
