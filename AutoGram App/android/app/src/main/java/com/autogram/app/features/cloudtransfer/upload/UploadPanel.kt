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
import com.autogram.app.runtime.NativeRuntime
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
    val albumProfileName = stringResource(R.string.cloud_upload_photo_album_profile_name)
    val queue = queueOverride ?: remember(profileName) { NativeUploadQueue(profileName) }
    val albumQueue = remember { NativePhotoAlbumQueue() }
    val actions = rememberCoroutineScope()
    var importJob by remember { mutableStateOf<Job?>(null) }
    var importing by remember { mutableStateOf(false) }
    var importProgress by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    var caption by rememberSaveable { mutableStateOf("") }
    var albumPacking by rememberSaveable { mutableStateOf(NativeAlbumPacking.SMART_ADAPTIVE) }
    var albumGridSize by rememberSaveable { mutableIntStateOf(10) }
    LaunchedEffect(scope.accountId) {
        if (queueOverride == null && scope.accountId.isNotBlank()) {
            try {
                val preference = withContext(Dispatchers.IO) { albumQueue.packingPreference(scope.accountId) }
                albumPacking = preference.first
                albumGridSize = preference.second
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Keep the safe maximum-size default when profile loading fails. */ }
        }
    }
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
    var albumRecords by remember { mutableStateOf(emptyList<NativeCloudAlbum>()) }
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
    val albumPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val requested = CloudScope(pickerAccount, pickerPeer, pickerTopic.takeIf { it > 0 })
        pickerAccount = ""
        if (uris.isNotEmpty() && requested == scope && !importing && allowSelection) {
            if (uris.size !in 2..500) {
                feedback = R.string.cloud_upload_album_count
                feedbackArgs = emptyList()
            } else {
                importing = true
                importProgress = null
                feedback = null
                feedbackArgs = emptyList()
                val summaryCaption = pickerCaption
                importJob = actions.launch {
                    try {
                        val profile = withContext(Dispatchers.IO) {
                            albumQueue.prepareProfile(
                                requested.accountId, albumProfileName, albumPacking, albumGridSize,
                            )
                        }
                        val plan = planPhotoAlbumPacking(uris.size, profile.settings)
                        if (plan.separateItems > 0) {
                            feedback = R.string.cloud_upload_album_single_remainder
                            return@launch
                        }
                        val inputs = mutableListOf<NativeAlbumInput>()
                        var offset = 0
                        plan.groupSizes.forEachIndexed { groupIndex, size ->
                            inputs += importPhotoAlbum(context, uris.subList(offset, offset + size), requested,
                                if (groupIndex == 0) summaryCaption else "")
                            offset += size
                        }
                        check(offset == uris.size && inputs.isNotEmpty())
                        val admitted = withContext(Dispatchers.IO) { albumQueue.enqueueBatch(inputs, profile) }
                        check(admitted.size == inputs.size && admitted.all { it.accountId == requested.accountId })
                        feedback = if (albumQueue.wake(context)) {
                            if (admitted.size == 1) R.string.cloud_upload_album_queued
                            else R.string.cloud_upload_album_batch_queued
                        } else R.string.cloud_upload_waiting
                        feedbackArgs = if (admitted.size == 1) emptyList() else listOf(admitted.size, uris.size)
                        NativeRuntime.invalidate("transfer_task_changed")
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: PartialPhotoAlbumBatchFailure) {
                        feedback = if (albumQueue.wake(context)) R.string.cloud_upload_album_batch_partial
                            else R.string.cloud_upload_waiting
                        feedbackArgs = if (feedback == R.string.cloud_upload_album_batch_partial)
                            listOf(failure.admitted, failure.total) else emptyList()
                    }
                    catch (failure: UploadSpoolFailure) {
                        feedback = if (failure.code == "insufficient_storage") R.string.cloud_upload_storage
                            else if (failure.code == "album_jpeg_only") R.string.cloud_upload_album_jpeg_only
                            else R.string.cloud_upload_failed
                    }
                    catch (failure: NativeUploadException.RequestFailed) {
                        feedback = if (failure.code == "unsupported_profile") R.string.cloud_upload_album_profile
                            else R.string.cloud_upload_failed
                    }
                    catch (_: Exception) { feedback = R.string.cloud_upload_failed }
                    catch (_: LinkageError) { feedback = R.string.cloud_upload_failed }
                    finally {
                        withContext(NonCancellable + Dispatchers.IO) {
                            try { albumQueue.schedule(context.applicationContext) }
                            catch (cancelled: CancellationException) { throw cancelled }
                            catch (_: Exception) { }
                        }
                        importing = false
                        importProgress = null
                    }
                }
            }
        } else if (uris.isNotEmpty()) feedback = R.string.cloud_upload_scope_changed
    }
    LaunchedEffect(scope, queue) {
        while (isActive) {
            try {
                records = withContext(Dispatchers.IO) { queue.list(scope.accountId) }.filter { it.belongsTo(scope) }
                albumRecords = if (queueOverride == null) {
                    withContext(Dispatchers.IO) { albumQueue.list(scope.accountId) }
                        .filter { it.peerId == canonicalUploadPeer(scope.accountId, scope.peerId) && it.topicId?.toLong() == scope.topicId }
                } else emptyList()
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
                PhotoAlbumGridPicker(
                    packing = albumPacking,
                    customSize = albumGridSize,
                    onPackingChange = { albumPacking = it },
                    onCustomSizeChange = { albumGridSize = it },
                )
                OutlinedTextField(caption, { caption = it }, enabled = !importing,
                    label = { Text(stringResource(R.string.cloud_upload_caption)) }, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !importing && scope.accountId.isNotBlank() && allowSelection, onClick = {
                        pickerAccount = scope.accountId; pickerPeer = scope.peerId
                        pickerTopic = scope.topicId ?: 0; pickerCaption = caption
                        picker.launch(arrayOf("*/*"))
                    }, modifier = Modifier.testTag("cloud-upload-choose")) {
                        Text(stringResource(R.string.cloud_upload_choose))
                    }
                    OutlinedButton(enabled = !importing && scope.accountId.isNotBlank() && allowSelection, onClick = {
                        pickerAccount = scope.accountId; pickerPeer = scope.peerId
                        pickerTopic = scope.topicId ?: 0; pickerCaption = caption
                        albumPicker.launch(arrayOf("image/jpeg"))
                    }, modifier = Modifier.testTag("cloud-upload-choose-album")) {
                        Text(stringResource(R.string.cloud_upload_album_choose))
                    }
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
                albumRecords.forEach { record ->
                    UploadAlbumRow(record, onControl = { action -> actions.launch {
                        try {
                            withContext(Dispatchers.IO) { albumQueue.control(record.accountId, record.operationId, action) }
                            if (action == "resume" && !albumQueue.wake(context)) feedback = R.string.cloud_upload_waiting
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { feedback = R.string.cloud_upload_failed }
                    } }, onReconcile = { actions.launch {
                        try { withContext(Dispatchers.IO) { albumQueue.reconcile(record.accountId, record.operationId) } }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { feedback = R.string.cloud_upload_review }
                    } })
                }
            }
        }, confirmButton = { TextButton(onClick = { importJob?.cancel(); onDismiss() }) {
            Text(stringResource(R.string.native_close))
        } })
}
