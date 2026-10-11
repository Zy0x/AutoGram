package com.autogram.app.features.cloudtransfer.upload

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.autogram.app.features.cloud.CloudScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import uniffi.autogram_android_bridge.NativeUploadInput
import uniffi.autogram_android_bridge.cloudUploadStagingDirectory
import java.io.File
import java.util.UUID

/** The SAF grant is read immediately into private storage; no guessed provider path. */
internal suspend fun importUpload(context: Context, uri: Uri, scope: CloudScope, caption: String): NativeUploadInput =
    withContext(Dispatchers.IO) {
        require(uri.scheme == "content" && scope.accountId.isNotBlank() && scope.peerId.isNotBlank())
        require(scope.topicId == null || scope.topicId in 1..Int.MAX_VALUE.toLong())
        val resolver = context.contentResolver
        var filename: String? = null
        var declaredSize: Long? = null
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameColumn >= 0 && !cursor.isNull(nameColumn)) filename = cursor.getString(nameColumn)
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) declaredSize = cursor.getLong(sizeColumn).takeIf { it >= 0 }
            }
        }
        val name = filename?.takeIf { it.isNotBlank() && it.length <= 255 &&
            it.none { character -> character == '/' || character == '\\' || character.isISOControl() } }
            ?: throw UploadSpoolFailure("invalid_request")
        val operation = UUID.randomUUID().toString()
        val root = File(cloudUploadStagingDirectory()).canonicalFile
        val coroutine = currentCoroutineContext()
        val staged = UploadSpool(root, { root.usableSpace }, AndroidUploadSpoolPublisher).import(
            operation, declaredSize, { resolver.openInputStream(uri) ?: throw UploadSpoolFailure("source_read_failed") },
            { coroutine.ensureActive() })
        // Never delete a published file after an ambiguous enqueue/cancellation: a
        // durable job may already own it. Native recovery uses this exact source.
        NativeUploadInput(operation, scope.accountId, scope.peerId, scope.topicId?.toInt(),
            staged.path.absolutePath, name, resolver.getType(uri) ?: "application/octet-stream", caption)
    }
