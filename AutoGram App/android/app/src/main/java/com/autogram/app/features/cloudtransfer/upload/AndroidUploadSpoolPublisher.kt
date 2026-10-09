package com.autogram.app.features.cloudtransfer.upload

import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileInputStream
import java.io.IOException

/** API 24 compatible exclusive target ownership; SELinux need not permit hard links. */
object AndroidUploadSpoolPublisher : UploadSpoolPublisher {
    override fun publish(partial: File, staged: File, ensureActive: () -> Unit) {
        // O_EXCL refuses a collision in the same syscall that reserves ownership.
        // Only the returned StagedUpload may enqueue; orphan files aren't jobs.
        val fd = Os.open(staged.path, OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_EXCL,
            OsConstants.S_IRUSR or OsConstants.S_IWUSR)
        var complete = false
        try {
            try {
                FileInputStream(partial).use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        ensureActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (count == 0) throw IOException("source_read_failed")
                        var offset = 0
                        while (offset < count) {
                            ensureActive()
                            val written = Os.write(fd, buffer, offset, count - offset)
                            if (written <= 0) throw IOException("staging_write_failed")
                            offset += written
                        }
                    }
                    Os.fsync(fd)
                }
            } finally { Os.close(fd) }
            ensureActive()
            Os.remove(partial.path)
            syncDirectory(requireNotNull(staged.parentFile))
            complete = true
        } finally {
            // The O_EXCL-created file belongs to this invocation, never an existing job.
            if (!complete) staged.delete()
        }
    }

    private fun syncDirectory(parent: File) {
        val directory = Os.open(parent.absolutePath, OsConstants.O_RDONLY, 0)
        try { Os.fsync(directory) } finally { Os.close(directory) }
    }
}
