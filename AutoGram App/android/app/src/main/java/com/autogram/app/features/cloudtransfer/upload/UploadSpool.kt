package com.autogram.app.features.cloudtransfer.upload

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream

/** Import ownership only. A staged file is not a queued job or a Telegram result. */
data class StagedUpload(val operationId: String, val path: File, val bytes: Long)

class UploadSpoolFailure(val code: String) : IOException(code)

/** Reserve the target atomically; return only after flushing. Never enqueue during publication. */
fun interface UploadSpoolPublisher { fun publish(partial: File, staged: File, ensureActive: () -> Unit) }

/**
 * Root must come from the native app-storage staging contract, never a provider's
 * display name/path. Call from IO; pass the coroutine's ensureActive for cancellation.
 * Failures delete only this invocation's newly created partial, never existing jobs.
 */
class UploadSpool(
    private val stagingRoot: File,
    private val availableBytes: () -> Long,
    private val publisher: UploadSpoolPublisher,
) {
    companion object {
        const val MAX_BYTES = 8_000L * 512 * 1024
        private const val RESERVE_BYTES = 64L * 1024 * 1024
    }

    fun import(
        operationId: String,
        declaredSize: Long?,
        openInput: () -> InputStream,
        ensureActive: () -> Unit,
    ): StagedUpload {
        if (!operationId.matches(Regex("[A-Za-z0-9_-]{1,128}")) || declaredSize?.let { it <= 0 || it > MAX_BYTES } == true) {
            throw UploadSpoolFailure("invalid_request")
        }
        ensureActive()
        // Android app SELinux policies may prohibit hard links. Reserve room for
        // both the partial and the exclusively owned, flushed publication copy.
        val budget = ((availableBytes().coerceAtLeast(0) - RESERVE_BYTES) / 2).coerceAtMost(MAX_BYTES)
        if (budget <= 0 || declaredSize?.let { it > budget } == true) throw UploadSpoolFailure("insufficient_storage")
        if (!stagingRoot.isDirectory || stagingRoot.canonicalFile != stagingRoot.absoluteFile) {
            throw UploadSpoolFailure("invalid_staging_directory")
        }
        val partial = File(stagingRoot, "$operationId.partial")
        val staged = File(stagingRoot, "$operationId.staged")
        if (staged.exists() || !partial.createNewFile()) throw UploadSpoolFailure("operation_conflict")
        var published = false
        try {
            var copied = 0L
            openInput().use { input ->
                FileOutputStream(partial).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (count == 0) throw UploadSpoolFailure("source_read_failed")
                        if (copied > budget - count) throw UploadSpoolFailure("insufficient_storage")
                        output.write(buffer, 0, count)
                        copied += count
                    }
                    if (copied == 0L || declaredSize?.let { it != copied } == true) {
                        throw UploadSpoolFailure("source_size_changed")
                    }
                    output.fd.sync()
                }
            }
            ensureActive()
            publisher.publish(partial, staged, ensureActive)
            published = true
            return StagedUpload(operationId, staged, staged.length())
        } finally {
            // Best-effort removal of this invocation's partial only. A cleanup
            // failure must not hide the original cancellation/read failure.
            if (!published) partial.delete()
        }
    }
}
