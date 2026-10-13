package com.autogram.app.features.cloudtransfer.upload

import android.content.Context
import android.net.Uri
import com.autogram.app.features.cloud.CloudScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import uniffi.autogram_android_bridge.NativeAlbumInput
import uniffi.autogram_android_bridge.NativeAlbumItemInput
import uniffi.autogram_android_bridge.NativeUploadInput
import java.io.File
import java.util.UUID

internal suspend fun importPhotoAlbum(
    context: Context,
    uris: List<Uri>,
    scope: CloudScope,
    caption: String,
): NativeAlbumInput {
    require(uris.size in 2..10) { "album_item_count" }
    val operationId = UUID.randomUUID().toString()
    val items = ArrayList<NativeAlbumItemInput>(uris.size)
    for (uri in uris) {
        currentCoroutineContext().ensureActive()
        val staged: NativeUploadInput = importUpload(context, uri, scope, "")
        val extension = File(staged.filename).extension.lowercase()
        val mime = staged.mimeType.lowercase().let { if (it == "image/jpg") "image/jpeg" else it }
        if (mime != "image/jpeg" || extension !in setOf("jpg", "jpeg")) {
            throw UploadSpoolFailure("album_jpeg_only")
        }
        items += NativeAlbumItemInput(staged.stagedPath, staged.filename, "image/jpeg")
    }
    return NativeAlbumInput(
        operationId = operationId,
        accountId = scope.accountId,
        peerId = scope.peerId,
        topicId = scope.topicId?.toInt(),
        summaryCaption = caption,
        items = items,
    )
}
