package com.autogram.app.features.cloudtransfer.upload

import kotlinx.coroutines.CancellationException

internal enum class UploadAdmissionOutcome { QUEUED, REUSED }

internal data class UploadBatchSummary(
    val total: Int,
    val queued: Int,
    val reused: Int
) {
    val accepted: Int get() = queued + reused
}

internal class PartialUploadBatchFailure(
    val summary: UploadBatchSummary,
    cause: Throwable
) : Exception(cause)

/** Admit each picked file independently, retaining exact accepted/reused counts on failure. */
internal suspend fun enqueueUploadBatch(
    total: Int,
    admit: suspend (index: Int) -> UploadAdmissionOutcome,
    onProgress: (completedIndex: Int, total: Int) -> Unit = { _, _ -> },
    onCancelled: suspend (UploadBatchSummary) -> Unit = {}
): UploadBatchSummary {
    require(total > 0)
    var queued = 0
    var reused = 0
    for (index in 0 until total) {
        onProgress(index + 1, total)
        try {
            when (admit(index)) {
                UploadAdmissionOutcome.QUEUED -> queued++
                UploadAdmissionOutcome.REUSED -> reused++
            }
        } catch (cancelled: CancellationException) {
            val summary = UploadBatchSummary(total, queued, reused)
            if (summary.accepted > 0) onCancelled(summary)
            throw cancelled
        } catch (failure: Exception) {
            val summary = UploadBatchSummary(total, queued, reused)
            if (summary.accepted > 0) throw PartialUploadBatchFailure(summary, failure)
            throw failure
        } catch (failure: LinkageError) {
            val summary = UploadBatchSummary(total, queued, reused)
            if (summary.accepted > 0) throw PartialUploadBatchFailure(summary, failure)
            throw failure
        }
    }
    return UploadBatchSummary(total, queued, reused)
}
