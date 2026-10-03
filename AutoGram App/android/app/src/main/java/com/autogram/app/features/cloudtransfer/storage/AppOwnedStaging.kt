package com.autogram.app.features.cloudtransfer.storage

import android.content.Context
import android.os.ParcelFileDescriptor
import android.os.Build
import android.system.Os
import android.system.OsConstants
import android.system.ErrnoException
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

/** Fixed private root; callers cannot designate external storage or arbitrary approved roots. */
class AppOwnedStaging(context: Context) {
    private val filesRoot = context.applicationContext.filesDir.canonicalFile
    val directory: File get() = File(filesRoot, "cloudtransfer/staging")

    /** Approval never creates, writes, or deletes files. Native worker owns staging creation. */
    fun approve(completedFile: File): StagingApproval {
        return try {
            val file = validatePath(completedFile)
            val stat = Os.lstat(file.path)
            if (!OsConstants.S_ISREG(stat.st_mode)) throw OutputFault(OutputError.UNSAFE_STAGING)
            StagingApproval.Approved(ApprovedStagingFile(this, file, stat.st_dev, stat.st_ino))
        } catch (fault: OutputFault) {
            StagingApproval.Rejected(fault.error)
        } catch (_: Exception) {
            StagingApproval.Rejected(OutputError.STAGING_UNAVAILABLE)
        }
    }

    internal fun open(approval: ApprovedStagingFile, expected: ExpectedOutput): InputStream {
        val file = validatePath(approval.file)
        // O_NOFOLLOW closes the final-component race. Check the actual opened descriptor
        // too, so replacing an ancestor with a symlink cannot escape the private root.
        val closeOnExec = if (Build.VERSION.SDK_INT >= 27) OsConstants.O_CLOEXEC else 0
        val fd = try {
            Os.open(file.path, OsConstants.O_RDONLY or closeOnExec or
                OsConstants.O_NOFOLLOW or OsConstants.O_NONBLOCK, 0)
        } catch (error: ErrnoException) {
            throw OutputFault(if (error.errno == OsConstants.ELOOP) OutputError.UNSAFE_STAGING
                else OutputError.STAGING_UNAVAILABLE)
        }
        try {
            val stat = Os.fstat(fd)
            // The duplicate only obtains a public numeric descriptor for the path check.
            // Return the original descriptor: dup may clear close-on-exec on older Android.
            val openedPath = ParcelFileDescriptor.dup(fd).use {
                Os.readlink("/proc/self/fd/${it.fd}")
            }
            if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_dev != approval.device ||
                stat.st_ino != approval.inode || openedPath != file.path)
                throw OutputFault(OutputError.UNSAFE_STAGING)
            validatePath(file)
            if (stat.st_size != expected.size) throw OutputFault(OutputError.SOURCE_SIZE_MISMATCH)
            return FileInputStream(fd)
        } catch (failure: Exception) {
            Os.close(fd)
            throw failure
        }
    }

    private fun validatePath(candidate: File): File {
        val absolute = candidate.absoluteFile
        val relative = absolute.path.removePrefix(directory.path + File.separator)
        if (relative == absolute.path || relative.isEmpty() ||
            relative.split(File.separatorChar).any { it.isEmpty() || it == "." || it == ".." })
            throw OutputFault(OutputError.UNSAFE_STAGING)
        var current = filesRoot
        for (part in listOf("cloudtransfer", "staging") + relative.split(File.separatorChar)) {
            current = File(current, part)
            if (OsConstants.S_ISLNK(Os.lstat(current.path).st_mode))
                throw OutputFault(OutputError.UNSAFE_STAGING)
        }
        if (absolute.canonicalFile != absolute) throw OutputFault(OutputError.UNSAFE_STAGING)
        return absolute
    }
}

class ApprovedStagingFile internal constructor(
    internal val owner: AppOwnedStaging,
    internal val file: File,
    internal val device: Long,
    internal val inode: Long,
) {
    override fun toString() = "ApprovedStagingFile(redacted)"
}

sealed interface StagingApproval {
    data class Approved(val file: ApprovedStagingFile) : StagingApproval
    data class Rejected(val error: OutputError) : StagingApproval
}
