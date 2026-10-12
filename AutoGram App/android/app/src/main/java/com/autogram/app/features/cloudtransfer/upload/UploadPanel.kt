package com.autogram.app.features.cloudtransfer.upload

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.features.cloud.CloudScope
import kotlinx.coroutines.*
import uniffi.autogram_android_bridge.*

/** Explicit SAF selections enqueue original documents; visual albums use a separate contract. */
@Composable
fun UploadPanel(scope: CloudScope, destinationTitle: String, onDismiss: () -> Unit,
    queueOverride: UploadQueue? = null, allowSelection: Boolean = true) {
    key(scope) { ScopedUploadPanel(scope, destinationTitle, onDismiss, queueOverride, allowSelection) }
}

@Composable
private fun ScopedUploadPanel(scope: CloudScope, destinationTitle: String, onDismiss: () -> Unit,
    queueOverride: UploadQueue?, allowSelection: Boolean) {
    val context = LocalContext.current
    val profileName = stringResource(R.string.cloud_upload_profile_document)
    val queue = queueOverride ?: remember(profileName) { NativeUploadQueue(profileName) }
    val actions = rememberCoroutineScope()
    var importJob by remember { mutableStateOf<Job?>(null) }
    var importing by remember { mutableStateOf(false) }
    var importProgress by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    var caption by rememberSaveable { mutableStateOf("") }
    // Save picker ownership across recreation. A late result cannot use a newly
    // selected account/location, even if the launcher is registered again.
    var pickerAccount by rememberSaveable { mutableStateOf("") }
    var pickerPeer by rememberSaveable { mutableStateOf("") }
    var pickerTopic by rememberSaveable { mutableStateOf(0L) }
    var pickerCaption by rememberSaveable { mutableStateOf("") }
    var feedback by remember { mutableStateOf<Int?>(null) }
    var feedbackArgs by remember { mutableStateOf(emptyList<Int>()) }
    var loadFailed by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var records by remember { mutableStateOf(emptyList<NativeCloudUpload>()) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val requested = CloudScope(pickerAccount, pickerPeer, pickerTopic.takeIf { it > 0 })
        pickerAccount = ""
        if (uris.isNotEmpty() && requested == scope && !importing && allowSelection) {
            importing = true
            importProgress = null
            feedback = null
            feedbackArgs = emptyList()
            val originalCaption = pickerCaption
            importJob = actions.launch {
                try {
                    val summary = enqueueUploadBatch(uris.size, admit = { index ->
                        val input = importUpload(context, uris[index], requested, originalCaption)
                        when (val result = withContext(Dispatchers.IO) {
                            queue.enqueue(input).also { validateAdmission(input, it) }
                        }) {
                            is NativeUploadAdmission.Queued -> UploadAdmissionOutcome.QUEUED
                            is NativeUploadAdmission.Reused -> UploadAdmissionOutcome.REUSED
                        }
                    }, onProgress = { current, total -> importProgress = current to total },
                        onCancelled = { summary ->
                            wakeAcceptedUploads(queue, context, summary.queued)
                            feedback = R.string.cloud_upload_batch_partial
                            feedbackArgs = listOf(summary.accepted, summary.total)
                        })
                    val woke = summary.queued == 0 || wakeUploadQueue(queue, context)
                    feedback = when {
                        summary.queued == 0 -> R.string.cloud_upload_batch_reused
                        !woke -> R.string.cloud_upload_waiting
                        else -> R.string.cloud_upload_batch_queued
                    }
                    feedbackArgs = when {
                        summary.queued == 0 -> listOf(summary.reused)
                        !woke -> emptyList()
                        else -> listOf(summary.queued, summary.reused)
                    }
                } catch (failure: PartialUploadBatchFailure) {
                    wakeAcceptedUploads(queue, context, failure.summary.queued)
                    feedback = R.string.cloud_upload_batch_partial
                    feedbackArgs = listOf(failure.summary.accepted, failure.summary.total)
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: UploadSpoolFailure) {
                    feedbackArgs = emptyList()
                    feedback = if (failure.code == "insufficient_storage") R.string.cloud_upload_storage else R.string.cloud_upload_failed
                }
                catch (failure: NativeUploadException.RequestFailed) {
                    feedbackArgs = emptyList()
                    feedback = if (failure.code == "review_required" || failure.code == "busy")
                        R.string.cloud_upload_duplicate_review else R.string.cloud_upload_failed
                }
                catch (_: Exception) { feedbackArgs = emptyList(); feedback = R.string.cloud_upload_failed }
                catch (_: LinkageError) { feedbackArgs = emptyList(); feedback = R.string.cloud_upload_failed }
                finally {
                    // Cancellation may race a committed enqueue. Register recovery
                    // even when its coroutine didn't receive the native result.
                    withContext(NonCancellable + Dispatchers.IO) {
                        try { queue.schedule(context.applicationContext) }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { /* Actual queue stays persisted; no execution promise. */ }
                    }
                    importing = false
                    importProgress = null
                }
            }
        } else if (uris.isNotEmpty()) feedback = R.string.cloud_upload_scope_changed
    }
    LaunchedEffect(scope, queue) {
        while (isActive) {
            try {
                records = withContext(Dispatchers.IO) { queue.list(scope.accountId) }.filter { it.belongsTo(scope) }
                loadFailed = false
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { loadFailed = true }
            catch (_: LinkageError) { loadFailed = true }
            loading = false
            delay(750)
        }
    }
    AlertDialog(onDismissRequest = { importJob?.cancel(); onDismiss() },
        modifier = Modifier.testTag("cloud-upload-panel"),
        title = { Text(stringResource(R.string.cloud_upload_title)) },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.cloud_upload_destination, destinationTitle))
                Text(stringResource(R.string.cloud_upload_document_notice))
                if (!allowSelection) Text(stringResource(R.string.cloud_upload_choose_topic))
                OutlinedTextField(caption, { caption = it }, enabled = !importing,
                    label = { Text(stringResource(R.string.cloud_upload_caption)) }, modifier = Modifier.fillMaxWidth())
                Button(enabled = !importing && scope.accountId.isNotBlank() && allowSelection, onClick = {
                    pickerAccount = scope.accountId; pickerPeer = scope.peerId
                    pickerTopic = scope.topicId ?: 0; pickerCaption = caption
                    picker.launch(arrayOf("*/*"))
                }, modifier = Modifier.testTag("cloud-upload-choose")) {
                    Text(stringResource(R.string.cloud_upload_choose))
                }
                if (importing) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    val progress = importProgress
                    if (progress == null) Text(stringResource(R.string.cloud_upload_importing))
                    else Text(stringResource(R.string.cloud_upload_batch_progress, progress.first, progress.second))
                    TextButton(onClick = { importJob?.cancel() }) { Text(stringResource(R.string.drive_action_cancel)) }
                }
                feedback?.let { Text(stringResource(it, *feedbackArgs.toTypedArray())) }
                if (loadFailed) Text(stringResource(R.string.cloud_upload_failed), color = MaterialTheme.colorScheme.error)
                else if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                else if (records.isEmpty()) Text(stringResource(R.string.cloud_upload_empty))
                records.forEach { record ->
                    UploadRow(record, onControl = { action -> actions.launch {
                        try {
                            withContext(Dispatchers.IO) { queue.control(record.accountId, record.operationId, action) }
                            if (action == "retry" && !queue.wake(context)) feedback = R.string.cloud_upload_waiting
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { feedback = R.string.cloud_upload_failed }
                    } }, onReconcile = { actions.launch {
                        try { withContext(Dispatchers.IO) { queue.reconcile(record.accountId, record.operationId) } }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { feedback = R.string.cloud_upload_review }
                    } })
                }
            }
        }, confirmButton = { TextButton(onClick = { importJob?.cancel(); onDismiss() }) {
            Text(stringResource(R.string.native_close))
        } })
}
