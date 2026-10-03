package com.autogram.app.features.cloudtransfer

import android.app.Notification
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

/** One process executor; Rust's exclusive file lock protects cross-process recovery too. */
internal object DownloadDispatch {
    private val mutex = Mutex()
    suspend fun drain() = mutex.withLock {
        val attempted = mutableSetOf<String>()
        while (currentCoroutineContext().isActive) {
            val pending = withContext(Dispatchers.IO) { pendingCloudDownloads() }
                .filter { it.operationId !in attempted }
            if (pending.isEmpty()) break
            for (item in pending) {
                currentCoroutineContext().ensureActive()
                attempted += item.operationId
                try { runCloudDownload(item.accountId, item.operationId) }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: NativeDownloadException) { /* Native state/error inspected by the UI; never claim success. */ }
                NativeRuntime.invalidate("transfer_task_changed")
            }
        }
        // A Publishing row delayed by FloodWait is absent from pending(), but its
        // durable commit still needs a later scheduler run. Failed rows remain manual retry.
        withContext(Dispatchers.IO) { hasRecoverableCloudDownloads() }
    }
}

object DownloadScheduling {
    private const val JOB_ID = 0x415547
    /** Register before launch so process death retains a real queue recovery trigger. */
    fun schedule(context: Context): Boolean {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        val job = JobInfo.Builder(JOB_ID, ComponentName(context, DownloadRecoveryJob::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .build()
        return scheduler.schedule(job) == JobScheduler.RESULT_SUCCESS
    }
    /** Call only from an actual visible user action, never from a boot receiver/background job. */
    fun startFromUi(context: Context): Boolean = try {
        val scheduled = schedule(context)
        ContextCompat.startForegroundService(context, Intent(context, CloudDownloadForegroundService::class.java))
        scheduled
    } catch (_: Exception) { false }
}

class CloudDownloadForegroundService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var worker: Job? = null
    override fun onCreate() {
        super.onCreate()
        val notification = downloadNotification(this)
        if (Build.VERSION.SDK_INT >= 29) startForeground(41025, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(41025, notification)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (worker?.isActive != true) worker = scope.launch {
            try { DownloadDispatch.drain() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { NativeRuntime.invalidate("transfer_task_changed") }
            finally { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
        }
        return START_NOT_STICKY // Durable JobScheduler + queue, not a promise to bypass force-stop.
    }
    override fun onBind(intent: Intent?) = null
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}

/** Platform may defer/stop this job. Dropped reads leave flushed checkpoints for later recovery. */
class DownloadRecoveryJob : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var worker: Job? = null
    override fun onStartJob(params: JobParameters): Boolean {
        worker = scope.launch {
            var retry = false
            try { retry = DownloadDispatch.drain() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { retry = true }
            finally { if (isActive) jobFinished(params, retry) }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean { worker?.cancel(); return true }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}

private fun downloadNotification(context: Context): Notification {
    val manager = context.getSystemService(NotificationManager::class.java)
    val channel = "cloud_downloads"
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
        NotificationChannel(channel, context.getString(R.string.cloud_download_title), NotificationManager.IMPORTANCE_LOW))
    val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(context, channel)
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle(context.getString(R.string.cloud_download_title))
        .setContentText(context.getString(R.string.cloud_download_notification))
        .setContentIntent(open).setOngoing(true).build()
}
