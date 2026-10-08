package com.autogram.app.features.cloud.preview.image

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.autogram.app.features.cloud.CloudFailure
import com.autogram.app.features.cloud.preview.CloudRangeSource
import kotlinx.coroutines.*
import java.io.File
import java.io.FileOutputStream

/** Encoded bytes are spooled, never allocated as a full-size ByteArray in RAM. */
internal suspend fun decodeCloudImage(source: CloudRangeSource, directory: File): Bitmap = withContext(Dispatchers.IO) {
    if (source.size <= 0 || source.size > 256L * 1024 * 1024) throw CloudFailure("cloud_image_too_large")
    if (directory.usableSpace < source.size + 4L * 1024 * 1024) throw CloudFailure("storage_space_unavailable")
    val spool = File.createTempFile("autogram-preview-image-", ".bin", directory)
    try {
        FileOutputStream(spool).use { output ->
            var offset = 0L
            while (offset < source.size) {
                currentCoroutineContext().ensureActive()
                val bytes = source.read(offset, minOf(source.size - offset, CloudRangeSource.MAX_READ.toLong()).toInt())
                if (bytes.isEmpty()) throw CloudFailure("cloud_media_truncated")
                output.write(bytes)
                offset += bytes.size
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(spool.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw CloudFailure("cloud_format_unsupported")
        val decoded = try {
            BitmapFactory.decodeFile(spool.path, BitmapFactory.Options().apply {
                inSampleSize = imageSampleSize(bounds.outWidth, bounds.outHeight)
            }) ?: throw CloudFailure("cloud_format_unsupported")
        } catch (_: OutOfMemoryError) { throw CloudFailure("cloud_image_too_large") }
        if (!currentCoroutineContext().isActive) { decoded.recycle(); currentCoroutineContext().ensureActive() }
        decoded
    } finally { spool.delete() }
}
