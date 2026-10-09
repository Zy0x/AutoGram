package com.autogram.app.features.cloudtransfer

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.Manifest
import android.os.Build
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.features.cloudtransfer.storage.*
import com.autogram.app.features.cloudtransfer.services.DownloadQueue
import com.autogram.app.features.cloudtransfer.services.NativeDownloadQueue
import com.autogram.app.viewmodel.DriveFileItem
import kotlinx.coroutines.*
import uniffi.autogram_android_bridge.*
import java.io.File

/** Actual native queue, separate from legacy metadata tasks. Private completion means ready to save. */
@Composable
fun DownloadPanel(accountId: String, selected: DriveFileItem?, onConsumed: () -> Unit,
    queue: DownloadQueue = NativeDownloadQueue, showLauncher: Boolean = true,
    openRequested: Boolean = false, onOpenRequestConsumed: () -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val accountActions = remember(accountId) {
        CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))
    }
    val output = remember(context) { SafDownloadOutput(context) }
    val journal = remember(context) { DownloadExportJournal(context) }
    val presentation = remember(context) { DownloadPresentationStore(context) }
    var visible by remember(accountId) { mutableStateOf(false) }
    var records by remember(accountId) { mutableStateOf(emptyList<NativeCloudDownload>()) }
    var error by remember(accountId) { mutableStateOf(false) }
    var loadFailed by remember(accountId) { mutableStateOf(false) }
    var copying by remember(accountId) { mutableStateOf(false) }
    var copyJob by remember(accountId) { mutableStateOf<Job?>(null) }
    var feedback by remember(accountId) { mutableStateOf<Int?>(null) }
    var pending by remember(accountId) { mutableStateOf<Pair<CreateDocumentRequest, NativeCloudDownload>?>(null) }
    val latestAccount by rememberUpdatedState(accountId)
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { /* Denial does not fabricate success or bypass foreground restrictions. */ }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val request = pending
        pending = null
        if (request != null && request.second.accountId == latestAccount) {
            val accepted = output.acceptCreatedDocument(request.first, result.resultCode, result.data)
            if (accepted is DocumentAcceptance.Accepted) {
                copyJob = accountActions.launch {
                    copying = true
                    feedback = null
                    val item = request.second
                    try {
                        withContext(Dispatchers.IO) { journal.started(item.accountId, item.operationId, accepted.ownership.uri.toString()) }
                        val expected = item.sha256?.let { ExpectedOutput.parse(item.size.toLong(), it) }
                        val path = item.completedFile
                        val approved = path?.let { AppOwnedStaging(context).approve(File(it)) }
                        val publication = if (approved is StagingApproval.Approved && expected != null)
                            output.publish(approved.file, expected, accepted.ownership) else null
                        val verified = publication is OutputPublication.Verified
                        withContext(Dispatchers.IO) { journal.finished(item.accountId, item.operationId, verified) }
                        if (latestAccount == item.accountId) feedback = if (verified)
                            R.string.cloud_download_saved else R.string.cloud_download_save_failed
                    } catch (cancelled: CancellationException) {
                        withContext(NonCancellable + Dispatchers.IO) { journal.finished(item.accountId, item.operationId, false) }
                        throw cancelled
                    } catch (_: Exception) {
                        if (latestAccount == item.accountId) feedback = R.string.cloud_download_save_failed
                    } finally { copying = false }
                }
            } else feedback = R.string.cloud_download_save_failed
        }
    }
    DisposableEffect(accountActions) { onDispose { accountActions.cancel() } }
    LaunchedEffect(openRequested) {
        if (openRequested) {
            visible = true
            onOpenRequestConsumed()
        }
    }
    LaunchedEffect(accountId, selected?.id) {
        val item = selected
        if (item != null) {
            onConsumed()
            if (item.cloudAccountId == accountId && item.cloudPeerId != null && item.cloudMessageId != null) {
                visible = true
                if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context,
                    Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                // Consuming selection cancels this effect; the UI scope owns enqueue
                // independently. Account disposal still cancels stale preflight work.
                accountActions.launch {
                    try {
                        val operation = queue.enqueueScoped(accountId, item.cloudPeerId, item.topicId, item.cloudMessageId)
                        if (!queue.wake(context)) error = true
                        withContext(Dispatchers.IO) { presentation.put(accountId, operation, item.name, item.mimeType) }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: NativeDownloadException) { error = true }
                    catch (_: Exception) { error = true }
                }
            }
        }
    }
    LaunchedEffect(accountId, visible) {
        if (visible && accountId.isNotEmpty()) while (isActive) {
            try {
                val loaded = withContext(Dispatchers.IO) { queue.list(accountId) }
                // Never display/control a record belonging to another account, even
                // if an adapter returns an incorrectly scoped result.
                records = loaded.filter { it.accountId == accountId }
                loadFailed = false
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { loadFailed = true }
            catch (_: LinkageError) { loadFailed = true }
            delay(750)
        }
    }
    if (showLauncher) TextButton(enabled = accountId.isNotEmpty(), onClick = { visible = true }) {
        Text(stringResource(R.string.cloud_download_title))
    }
    if (visible) AlertDialog(onDismissRequest = { if (!copying) visible = false },
        title = { Text(stringResource(R.string.cloud_download_title)) },
        text = {
            Column(Modifier.fillMaxWidth().heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.cloud_download_private_notice))
                if (error || loadFailed) Text(stringResource(R.string.cloud_download_failed), color = MaterialTheme.colorScheme.error)
                feedback?.let { Text(stringResource(it)) }
                if (copying) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text(stringResource(R.string.cloud_download_copying))
                    TextButton(onClick = { copyJob?.cancel() }) { Text(stringResource(R.string.drive_action_cancel)) }
                }
                if (records.isEmpty()) Text(stringResource(R.string.cloud_download_empty))
                records.forEach { record ->
                    DownloadRow(record, journal.state(record.accountId, record.operationId), copying,
                        onControl = { action ->
                            accountActions.launch(Dispatchers.IO) {
                                try {
                                    queue.control(record.accountId, record.operationId, action)
                                    if (action == "retry") withContext(Dispatchers.Main) {
                                        if (!queue.wake(context)) error = true
                                    }
                                } catch (cancelled: CancellationException) { throw cancelled }
                                catch (_: Exception) { withContext(Dispatchers.Main) { error = true } }
                                catch (_: LinkageError) { withContext(Dispatchers.Main) { error = true } }
                            }
                        }, onSave = {
                            val info = presentation.get(record.accountId, record.operationId)
                            val request = output.createDocumentRequest(info?.outputMime() ?: "application/octet-stream",
                                info?.outputName() ?: "download_${record.messageId}.bin")
                            pending = request to record
                            picker.launch(request.intent)
                        })
                }
            }
        }, confirmButton = {
            TextButton(enabled = !copying, onClick = { visible = false }) { Text(stringResource(R.string.native_close)) }
        })
}

@Composable
private fun DownloadRow(record: NativeCloudDownload, exported: String?, copying: Boolean,
    onControl: (String) -> Unit, onSave: () -> Unit) {
    val stateLabel = when (record.state) {
        "queued" -> R.string.cloud_download_queued
        "running" -> R.string.cloud_download_running
        "paused" -> R.string.cloud_download_paused
        "cancelled" -> R.string.cloud_download_cancelled
        "publishing" -> R.string.cloud_download_verifying
        "completed" -> R.string.cloud_download_ready
        else -> R.string.cloud_download_failed
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(stringResource(R.string.cloud_download_message, record.messageId))
        Text(stringResource(stateLabel))
        Text(stringResource(R.string.cloud_download_bytes, record.processedBytes.toString(), record.size.toString()))
        if (exported == "saved") Text(stringResource(R.string.cloud_download_saved))
        if (exported == "interrupted" || exported == "copying") Text(stringResource(R.string.cloud_download_interrupted))
        if (record.errorCode != null) Text(stringResource(R.string.cloud_download_failed), color = MaterialTheme.colorScheme.error)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (record.state == "running" || record.state == "queued") TextButton(onClick = { onControl("pause") }) {
                Text(stringResource(R.string.cloud_download_pause))
            }
            if (record.state == "paused" || record.state == "failed") TextButton(
                enabled = record.retryNotBeforeMs?.let { it <= System.currentTimeMillis().toULong() } != false,
                onClick = { onControl("retry") }) { Text(stringResource(R.string.cloud_download_resume)) }
            if (record.state in listOf("queued", "running", "paused", "failed")) TextButton(onClick = { onControl("cancel") }) {
                Text(stringResource(R.string.drive_action_cancel))
            }
            if (record.state == "completed") TextButton(enabled = !copying, onClick = onSave) {
                Text(stringResource(R.string.cloud_download_save))
            }
        }
        HorizontalDivider()
    }
}
