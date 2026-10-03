package com.autogram.app.features.cloudtransfer.storage

import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest

/** Owns every stream supplied by the open callbacks, including on close/flush failure. */
internal object VerifiedStreamCopy {
    const val BUFFER_BYTES = 64 * 1024

    fun publish(
        expected: ExpectedOutput,
        source: () -> InputStream,
        output: () -> OutputStream,
        readBack: () -> InputStream,
        checkActive: () -> Unit,
        progress: PublicationProgress,
    ): OutputPublication.Verified {
        val buffer = ByteArray(BUFFER_BYTES)
        val copiedHash = MessageDigest.getInstance("SHA-256")
        checkActive()
        progress.phase = OutputPhase.COPY
        source().use { input ->
            output().use { target ->
                while (true) {
                    checkActive()
                    val length = input.read(buffer)
                    checkActive()
                    if (length == -1) break
                    if (length <= 0) throw OutputFault(OutputError.IO_FAILURE)
                    if (length.toLong() > expected.size - progress.copied)
                        throw OutputFault(OutputError.SOURCE_SIZE_MISMATCH)
                    // A failed write may already have written part of this chunk.
                    progress.mayHaveWritten = true
                    target.write(buffer, 0, length)
                    progress.copied += length
                    copiedHash.update(buffer, 0, length)
                }
                if (progress.copied != expected.size)
                    throw OutputFault(OutputError.SOURCE_SIZE_MISMATCH)
                if (hex(copiedHash.digest()) != expected.sha256)
                    throw OutputFault(OutputError.SOURCE_HASH_MISMATCH)
                checkActive()
                target.flush()
            }
        }
        // Closing the writer is required before reopening; metadata is not evidence.
        checkActive()
        progress.phase = OutputPhase.VERIFY
        val verifiedHash = MessageDigest.getInstance("SHA-256")
        readBack().use { input ->
            while (true) {
                checkActive()
                val length = input.read(buffer)
                checkActive()
                if (length == -1) break
                if (length <= 0) throw OutputFault(OutputError.IO_FAILURE)
                if (length.toLong() > expected.size - progress.verified) {
                    // Report observed bytes even for an oversized provider; saturate rather
                    // than overflowing for caller-supplied Long.MAX_VALUE expectations.
                    progress.verified = if (length.toLong() > Long.MAX_VALUE - progress.verified)
                        Long.MAX_VALUE else progress.verified + length
                    throw OutputFault(OutputError.OUTPUT_SIZE_MISMATCH)
                }
                progress.verified += length
                verifiedHash.update(buffer, 0, length)
            }
        }
        if (progress.verified != expected.size)
            throw OutputFault(OutputError.OUTPUT_SIZE_MISMATCH)
        val hash = hex(verifiedHash.digest())
        if (hash != expected.sha256) throw OutputFault(OutputError.OUTPUT_HASH_MISMATCH)
        checkActive()
        progress.phase = OutputPhase.COMPLETE
        return OutputPublication.Verified(progress.copied, progress.verified, hash)
    }

    private fun hex(bytes: ByteArray): String = buildString(bytes.size * 2) {
        for (byte in bytes) {
            append("0123456789abcdef"[(byte.toInt() ushr 4) and 15])
            append("0123456789abcdef"[byte.toInt() and 15])
        }
    }
}
