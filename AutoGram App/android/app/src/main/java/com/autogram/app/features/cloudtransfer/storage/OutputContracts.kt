package com.autogram.app.features.cloudtransfer.storage

/** Hash is copied into a normalized immutable string; no mutable byte array is retained. */
class ExpectedOutput private constructor(val size: Long, val sha256: String) {
    companion object {
        fun parse(size: Long, sha256: String): ExpectedOutput? =
            if (size >= 0 && sha256.matches(Regex("[a-fA-F0-9]{64}")))
                ExpectedOutput(size, sha256.lowercase(java.util.Locale.ROOT)) else null
    }
}

enum class OutputPhase { GRANT, STAGING, PREFLIGHT, COPY, VERIFY, COMPLETE }

enum class OutputError {
    INVALID_URI, PICKER_CANCELLED, INVALID_OWNERSHIP,
    GRANT_REQUIRED, GRANT_REVOKED, PERSISTENCE_UNAVAILABLE, UNSAFE_STAGING,
    STAGING_UNAVAILABLE, SOURCE_SIZE_MISMATCH, SOURCE_HASH_MISMATCH,
    TARGET_NOT_EMPTY, PROVIDER_UNAVAILABLE, OUTPUT_SIZE_MISMATCH,
    OUTPUT_HASH_MISMATCH, SPACE_EXHAUSTED, IO_FAILURE, PROVIDER_FAILURE,
}

/** No throwable/message/URI/path payload: safe for caller diagnostics and locale mapping. */
sealed interface OutputPublication {
    data class Verified(val bytesCopied: Long, val bytesVerified: Long, val sha256: String) : OutputPublication
    data class Failed(
        val error: OutputError,
        val phase: OutputPhase,
        val bytesCopied: Long = 0,
        val bytesVerified: Long = 0,
        val partialDocumentMayRemain: Boolean = false,
    ) : OutputPublication
}

internal class OutputFault(val error: OutputError) : RuntimeException(error.name)

internal class PublicationProgress {
    var phase = OutputPhase.STAGING
    var copied = 0L
    var verified = 0L
    var mayHaveWritten = false
    fun failed(error: OutputError) = OutputPublication.Failed(
        error, phase, copied, verified, mayHaveWritten,
    )
}
