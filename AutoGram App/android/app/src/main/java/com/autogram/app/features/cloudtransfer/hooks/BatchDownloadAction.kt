package com.autogram.app.features.cloudtransfer.hooks

import android.widget.Toast
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import com.autogram.app.R
import com.autogram.app.features.cloud.CloudScope
import com.autogram.app.features.cloudtransfer.DownloadPresentationStore
import com.autogram.app.features.cloudtransfer.DownloadPresentationWriter
import com.autogram.app.features.cloudtransfer.domain.*
import com.autogram.app.features.cloudtransfer.services.DownloadQueue
import com.autogram.app.features.cloudtransfer.services.NativeDownloadQueue
import com.autogram.app.viewmodel.DriveFileItem
import kotlinx.coroutines.*

/** UI adapter owns lifecycle/feedback; domain code owns scope validation and acknowledged counts. */
@Composable
fun rememberBatchDownloadAction(
    sourceScope: CloudScope,
    onAllQueued: (Set<String>) -> Unit,
    queue: DownloadQueue = NativeDownloadQueue,
    presentationWriter: DownloadPresentationWriter? = null
): (List<DriveFileItem>) -> Unit {
    val context = LocalContext.current
    val owner = rememberCoroutineScope()
    val actions = remember(sourceScope) {
        CoroutineScope(owner.coroutineContext + SupervisorJob(owner.coroutineContext[Job]))
    }
    val latestScope by rememberUpdatedState(sourceScope)
    val latestAllQueued by rememberUpdatedState(onAllQueued)
    var busy by remember(sourceScope) { mutableStateOf(false) }
    val presentation = remember(context, presentationWriter) { presentationWriter ?: DownloadPresentationStore(context) }
    DisposableEffect(actions) { onDispose { actions.cancel() } }
    return { selected ->
        if (!busy && selected.isNotEmpty()) {
            busy = true
            val requested = selected.map { BatchDownloadItem(it.id, it.cloudAccountId,
                it.cloudPeerId, it.topicId, it.cloudMessageId, it.name, it.mimeType) }
            actions.launch {
                try {
                    val result = withContext(Dispatchers.IO) {
                        enqueueDownloadBatch(sourceScope, requested,
                            enqueue = { item -> queue.enqueueScoped(sourceScope.accountId,
                                requireNotNull(item.peer), item.topic, requireNotNull(item.message)) },
                            presentation = { item, op -> presentation.put(sourceScope.accountId, op, item.name, item.mime) },
                            isCurrent = { latestScope == sourceScope })
                    }
                    ensureActive()
                    if (latestScope == sourceScope) {
                        val started = if (result.queued.isEmpty()) false else try { queue.wake(context) }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { false } catch (_: LinkageError) { false }
                        val message = when {
                            result.queued.isEmpty() -> context.getString(R.string.cloud_download_batch_failed, result.failed.size)
                            !started -> context.getString(R.string.cloud_download_batch_waiting, result.queued.size, result.failed.size)
                            else -> context.getString(R.string.cloud_download_batch_queued, result.queued.size, result.failed.size)
                        }
                        Toast.makeText(context, message, Toast.LENGTH_LONG).show()
                        if (result.failed.isEmpty()) latestAllQueued(result.queued)
                    }
                } finally { busy = false }
            }
        }
    }
}
