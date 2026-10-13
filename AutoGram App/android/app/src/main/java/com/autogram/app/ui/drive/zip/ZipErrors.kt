package com.autogram.app.ui.drive.zip

import android.content.Context
import com.autogram.app.R
import com.autogram.app.features.cloud.CloudFailure

fun zipErrorMessage(context: Context, error: Throwable): String {
    val code = (error as? CloudFailure)?.code
    return when (code) {
        "cloud_media_checksum_mismatch" -> context.getString(R.string.zip_integrity_failed)
        "zip_format_unsupported", "cloud_format_unsupported" -> context.getString(R.string.zip_format_unsupported)
        "zip_invalid_archive", "invalid_range", "cloud_media_truncated" -> context.getString(R.string.zip_invalid_archive)
        else -> error.localizedMessage ?: context.getString(R.string.zip_invalid_archive)
    }
}
