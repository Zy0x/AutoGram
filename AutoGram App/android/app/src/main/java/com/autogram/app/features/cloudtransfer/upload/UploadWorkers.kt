package com.autogram.app.features.cloudtransfer.upload

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.autogram.app.MainActivity
import com.autogram.app.R
import com.autogram.app.runtime.NativeRuntime
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import uniffi.autogram_android_bridge.*

internal object UploadDispatch {
    private val mutex = Mutex()
    suspend fun drain() = mutex.withLock {
        val attempted = mutableSetOf<String>()
        while (currentCoroutineContext().isActive) {
            val pending = pendingCloudUploads().filter { it.operationId !in attempted }
            if (pending.isEmpty()) break
            for (item in pending) {
                currentCoroutineContext().ensureActive()
                attempted += item.operationId
                try { startCloudUpload(item.accountId, item.operationId) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: NativeUploadException) { /* Actual persisted state is the UI's evidence. */ }
                NativeRuntime.invalidate("transfer_task_changed")
            }
        }
        // Future FloodWait deadlines are deliberately absent from pending().
        // JobScheduler may defer them; no tight retry loop or false completion.
        hasRecoverableCloudUploads()
    }
}

object UploadScheduling {
    private const val JOB_ID = 0x415548
    @Synchronized fun schedule(context: Context): Boolean {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        // schedule() replaces an existing job and stops its modifying RPC. Reuse
        // a registered recovery job, including one which is currently executing.
        if (scheduler.getPendingJob(JOB_ID) != null) return true
        return scheduler.schedule(JobInfo.Builder(JOB_ID, ComponentName(context, UploadRecoveryJob::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
            .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build()) == JobScheduler.RESULT_SUCCESS
    }
    fun startFromUi(context: Context): Boolean = try {
        val scheduled = schedule(context)
        ContextCompat.startForegroundService(context, Intent(context, CloudUploadForegroundService::class.java))
        scheduled
    } catch (_: Exception) { false }
    /** Recovery registration only; never launch a foreground service from cold start. */
    fun restore(context: Context) {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try { if (hasRecoverableCloudUploads()) schedule(context.applicationContext) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { NativeRuntime.invalidate("transfer_task_changed") }
        }
    }
}

class CloudUploadForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var worker: Job? = null
    private var latestStartId = 0
    override fun onCreate() {
        super.onCreate()
        val channel = "cloud_uploads"
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(
            channel, getString(R.string.cloud_upload_title), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, channel).setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(getString(R.string.cloud_upload_title)).setContentText(getString(R.string.cloud_upload_notification))
            .setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(41026, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(41026, notification)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        latestStartId = startId
        if (worker?.isActive != true) worker = scope.launch {
            while (isActive) {
                val iterationStart = latestStartId
                try { withContext(Dispatchers.IO) { UploadDispatch.drain() } }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { NativeRuntime.invalidate("transfer_task_changed") }
                // Main-thread completion cannot race another onStartCommand.
                // A request received while draining gets another admission pass.
                if (iterationStart == latestStartId) {
                    worker = null
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelfResult(iterationStart)
                    break
                }
            }
        }
        return START_NOT_STICKY
    }
    override fun onBind(intent: Intent?) = null
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}

class UploadRecoveryJob : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var worker: Job? = null
    override fun onStartJob(params: JobParameters): Boolean {
        worker = scope.launch {
            var retry = false
            try { retry = UploadDispatch.drain() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { retry = true }
            finally { if (isActive) jobFinished(params, retry) }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean { worker?.cancel(); return true }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
