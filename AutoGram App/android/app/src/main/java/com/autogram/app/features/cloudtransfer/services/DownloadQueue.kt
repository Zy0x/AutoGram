package com.autogram.app.features.cloudtransfer.services

import android.content.Context
import com.autogram.app.features.cloudtransfer.DownloadScheduling
import uniffi.autogram_android_bridge.*

/** UI test boundary; only the real native adapter is supplied by production routes. */
interface DownloadQueue {
    suspend fun enqueue(account: String, peer: String, message: Int): String
    fun list(account: String): List<NativeCloudDownload>
    fun control(account: String, operation: String, action: String)
    fun wake(context: Context): Boolean
}

object NativeDownloadQueue : DownloadQueue {
    override suspend fun enqueue(account: String, peer: String, message: Int) =
        enqueueCloudDownload(account, peer, null, message).operationId
    override fun list(account: String) = listCloudDownloads(account)
    override fun control(account: String, operation: String, action: String) =
        controlCloudDownload(account, operation, action)
    override fun wake(context: Context) = DownloadScheduling.startFromUi(context)
}
