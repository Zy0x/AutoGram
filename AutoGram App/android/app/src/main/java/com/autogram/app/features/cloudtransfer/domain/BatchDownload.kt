package com.autogram.app.features.cloudtransfer.domain

import com.autogram.app.features.cloud.CloudScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

data class BatchDownloadItem(
    val id: String, val account: String?, val peer: String?, val topic: Long?,
    val message: Int?, val name: String, val mime: String
)

data class BatchDownloadResult(val queued: Set<String>, val failed: Set<String>)

/** Only durable enqueue acknowledgement counts; neither metadata nor worker startup is completion. */
suspend fun enqueueDownloadBatch(
    scope: CloudScope,
    items: List<BatchDownloadItem>,
    enqueue: suspend (BatchDownloadItem) -> String,
    presentation: suspend (BatchDownloadItem, String) -> Unit,
    isCurrent: () -> Boolean
): BatchDownloadResult {
    val queued = mutableSetOf<String>()
    val failed = mutableSetOf<String>()
    suspend fun checkCurrent() {
        currentCoroutineContext().ensureActive()
        if (!isCurrent()) throw CancellationException("download_scope_changed")
    }
    for (item in items.distinctBy { it.id }) {
        checkCurrent()
        val valid = scope.accountId.isNotBlank() && scope.peerId.isNotBlank() &&
            item.account == scope.accountId && item.peer == scope.peerId && item.topic == scope.topicId &&
            item.message != null && item.message > 0 &&
            (item.topic == null || item.topic in 1..Int.MAX_VALUE.toLong())
        if (!valid) { failed.add(item.id); continue }
        val operation = try {
            enqueue(item).also { check(it.isNotBlank()) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { failed.add(item.id); continue }
        catch (_: LinkageError) { failed.add(item.id); continue }
        checkCurrent()
        queued.add(item.id)
        // A metadata failure cannot undo an already persisted native job or cause another enqueue.
        try { presentation(item, operation) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { /* Native queue still exposes its actual message ID and bytes. */ }
    }
    checkCurrent()
    return BatchDownloadResult(queued, failed)
}
