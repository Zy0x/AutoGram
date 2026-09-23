package com.autogram.app.features.localdownload

import android.app.DownloadManager
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/** All methods run on Dispatchers.IO. Android owns execution after enqueue, including retries. */
internal class LocalDownloadRepository(private val context: Context) {
    private val store = LocalDownloadStore(context)
    private val manager: DownloadManager
        get() = context.getSystemService(DownloadManager::class.java)
            ?: throw LocalDownloadException(LocalDownloadError.SERVICE)

    fun refresh(): List<LocalDownloadItem> {
        val records = store.records()
        if (records.isEmpty()) return emptyList()
        val found = mutableMapOf<Long, LocalDownloadItem>()
        val query = DownloadManager.Query().setFilterById(*records.keys.toLongArray())
        val cursor = manager.query(query) ?: throw LocalDownloadException(LocalDownloadError.REFRESH_FAILED)
        cursor.use {
            val idColumn = it.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)
            val statusColumn = it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
            val reasonColumn = it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)
            val bytesColumn = it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
            val totalColumn = it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
            val mimeColumn = it.getColumnIndexOrThrow(DownloadManager.COLUMN_MEDIA_TYPE)
            while (it.moveToNext()) {
                val id = it.getLong(idColumn)
                val filename = records[id] ?: continue
                val reason = it.getInt(reasonColumn)
                val status = when (it.getInt(statusColumn)) {
                    DownloadManager.STATUS_PENDING -> LocalDownloadStatus.PENDING
                    DownloadManager.STATUS_RUNNING -> LocalDownloadStatus.RUNNING
                    DownloadManager.STATUS_PAUSED -> when (reason) {
                        DownloadManager.PAUSED_WAITING_FOR_NETWORK, DownloadManager.PAUSED_QUEUED_FOR_WIFI ->
                            LocalDownloadStatus.WAITING_NETWORK
                        DownloadManager.PAUSED_WAITING_TO_RETRY -> LocalDownloadStatus.WAITING_RETRY
                        else -> LocalDownloadStatus.WAITING_SYSTEM
                    }
                    DownloadManager.STATUS_SUCCESSFUL -> if (LocalDownloadPolicy.acceptsContentType(
                            filename.substringAfterLast('.'), it.getString(mimeColumn)
                        )) LocalDownloadStatus.COMPLETED else LocalDownloadStatus.UNSUPPORTED
                    DownloadManager.STATUS_FAILED -> LocalDownloadStatus.FAILED
                    else -> LocalDownloadStatus.MISSING
                }
                found[id] = LocalDownloadItem(
                    id, filename, status, it.getLong(bytesColumn).coerceAtLeast(0),
                    it.getLong(totalColumn), reason.takeIf { status == LocalDownloadStatus.FAILED }
                )
            }
        }
        return records.map { (id, name) -> found[id] ?: LocalDownloadItem(id, name, LocalDownloadStatus.MISSING) }
    }

    fun enqueue(file: LocalDownloadPolicy.DirectFile) {
        val existing = refresh()
        if (existing.size >= LocalDownloadPolicy.MAX_TRACKED ||
            existing.count { it.status.active } >= LocalDownloadPolicy.MAX_ACTIVE
        ) throw LocalDownloadException(LocalDownloadError.LIMIT)
        probe(file)
        val directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: throw LocalDownloadException(LocalDownloadError.STORAGE)
        if ((!directory.exists() && !directory.mkdirs()) || !directory.isDirectory || !directory.canWrite()) {
            throw LocalDownloadException(LocalDownloadError.STORAGE)
        }
        val filename = LocalDownloadPolicy.filename(file, UUID.randomUUID().toString())
        val request = DownloadManager.Request(Uri.parse(file.uri.toASCIIString()))
            .setTitle(filename)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, filename)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        // Do not set MIME ourselves: retain the actual response MIME for completion checks.
        val id = manager.enqueue(request)
        try {
            store.add(id, filename)
        } catch (error: Exception) {
            // Never knowingly leave a job running that cannot be restored from preferences.
            manager.remove(id)
            throw error
        }
    }

    private fun probe(file: LocalDownloadPolicy.DirectFile) {
        val connection = file.uri.toURL().openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.requestMethod = "HEAD"
            val code = connection.responseCode
            if (code in 300..399) throw LocalDownloadException(LocalDownloadError.REDIRECT)
            if (code != 200) throw LocalDownloadException(LocalDownloadError.PROBE_FAILED)
            if (!LocalDownloadPolicy.acceptsContentType(file.extension, connection.contentType)) {
                throw LocalDownloadException(LocalDownloadError.CONTENT_TYPE)
            }
        } catch (error: LocalDownloadException) {
            throw error
        } catch (_: Exception) {
            // Never surface exceptions containing signed URLs, tokens, or server response bodies.
            throw LocalDownloadException(LocalDownloadError.PROBE_FAILED)
        } finally {
            connection.disconnect()
        }
    }

    fun cancel(id: Long) {
        val item = refresh().firstOrNull { it.id == id } ?: return
        // A job may have finished while its confirmation dialog was open. Preserve that file.
        if (!item.status.active) return
        manager.remove(id)
        store.forget(id)
    }

    fun forget(id: Long) {
        val item = refresh().firstOrNull { it.id == id } ?: return
        if (!item.status.active) store.forget(id) // Does not delete the downloaded file.
    }

    fun openIntent(id: Long): Intent {
        val item = refresh().firstOrNull { it.id == id && it.status == LocalDownloadStatus.COMPLETED }
            ?: throw LocalDownloadException(LocalDownloadError.OPEN_FAILED)
        val uri = manager.getUriForDownloadedFile(item.id)
            ?.takeIf { it.scheme == "content" }
            ?: throw LocalDownloadException(LocalDownloadError.OPEN_FAILED)
        context.contentResolver.openFileDescriptor(uri, "r")?.use { /* Verify it still exists. */ }
            ?: throw LocalDownloadException(LocalDownloadError.OPEN_FAILED)
        val mime = manager.getMimeTypeForDownloadedFile(item.id)
        if (!LocalDownloadPolicy.acceptsContentType(item.filename.substringAfterLast('.'), mime)) {
            throw LocalDownloadException(LocalDownloadError.OPEN_FAILED)
        }
        return Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mime)
            clipData = ClipData.newRawUri(item.filename, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }
}
