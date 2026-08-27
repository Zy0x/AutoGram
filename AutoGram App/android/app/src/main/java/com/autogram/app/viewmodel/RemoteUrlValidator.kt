package com.autogram.app.viewmodel

import java.net.URI

internal object RemoteUrlValidator {
    fun parseHost(value: String): String? = try {
        val uri = URI(value.trim())
        if ((uri.scheme == "http" || uri.scheme == "https") && !uri.host.isNullOrBlank()) {
            uri.host.lowercase()
        } else {
            null
        }
    } catch (_: Exception) {
        null
    }
}
