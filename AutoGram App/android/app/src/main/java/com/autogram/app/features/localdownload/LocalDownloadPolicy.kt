package com.autogram.app.features.localdownload

import java.net.URI
import java.util.Locale

/** Pure policy: no Android classes, resolver, network calls, or persisted URL. */
object LocalDownloadPolicy {
    const val MAX_TRACKED = 100
    const val MAX_ACTIVE = 3
    const val MAX_URL_LENGTH = 8192

    private val mimeTypes = mapOf(
        "mp4" to setOf("video/mp4"), "m4v" to setOf("video/mp4", "video/x-m4v"),
        "mkv" to setOf("video/x-matroska"), "webm" to setOf("video/webm", "audio/webm"),
        "mov" to setOf("video/quicktime"), "mp3" to setOf("audio/mpeg", "audio/mp3"),
        "m4a" to setOf("audio/mp4", "audio/x-m4a"), "aac" to setOf("audio/aac"),
        "wav" to setOf("audio/wav", "audio/x-wav", "audio/wave"),
        "flac" to setOf("audio/flac", "audio/x-flac"),
        "ogg" to setOf("audio/ogg", "video/ogg", "application/ogg"),
        "opus" to setOf("audio/opus", "audio/ogg"),
        "jpg" to setOf("image/jpeg"), "jpeg" to setOf("image/jpeg"),
        "png" to setOf("image/png"), "gif" to setOf("image/gif"),
        "webp" to setOf("image/webp"), "avif" to setOf("image/avif"),
        "pdf" to setOf("application/pdf"),
        "zip" to setOf("application/zip", "application/x-zip-compressed"),
        "7z" to setOf("application/x-7z-compressed"),
        "rar" to setOf("application/vnd.rar", "application/x-rar-compressed"),
        "tar" to setOf("application/x-tar"),
        "gz" to setOf("application/gzip", "application/x-gzip")
    )
    private val providerHosts = setOf(
        "youtube.com", "youtu.be", "youtube-nocookie.com", "tiktok.com", "instagram.com",
        "twitter.com", "x.com", "facebook.com", "fb.watch", "vimeo.com", "dailymotion.com",
        "pinterest.com", "pin.it", "pixiv.net", "twitch.tv"
    )

    data class DirectFile(val uri: URI, val basename: String, val extension: String)

    fun validate(input: String): DirectFile? = runCatching {
        val text = input.trim()
        if (text.isEmpty() || text.length > MAX_URL_LENGTH || text.any { it.isISOControl() }) return null
        val uri = URI(text)
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.isOpaque ||
            uri.rawUserInfo != null || uri.rawFragment != null ||
            (uri.port != -1 && uri.port !in 1..65535)
        ) return null
        val host = uri.host?.lowercase(Locale.ROOT)?.trimEnd('.') ?: return null
        if (host.isBlank() || providerHosts.any { host == it || host.endsWith(".$it") }) return null
        // Decode the path once; reject escaped separators and ambiguous double encoding.
        val rawPath = uri.rawPath.orEmpty()
        if (Regex("%(?:2f|5c|25)", RegexOption.IGNORE_CASE).containsMatchIn(rawPath)) return null
        val path = uri.path.orEmpty()
        if (path.any { it.isISOControl() || it == '\\' } || path.split('/').any { it == ".." }) return null
        if (Regex("(?:^|/)(?:watch|embed|shorts|reel|reels|live)(?:/|$)", RegexOption.IGNORE_CASE)
                .containsMatchIn(path)) return null
        if (Regex("\\.(?:m3u8?|mpd)(?:/|$)", RegexOption.IGNORE_CASE).containsMatchIn(path)) return null
        val basename = path.substringAfterLast('/')
        val extension = basename.substringAfterLast('.', "").lowercase(Locale.ROOT)
        if (extension !in mimeTypes || basename.substringBeforeLast('.').isBlank()) return null
        DirectFile(uri, basename, extension)
    }.getOrNull()

    fun acceptsContentType(extension: String, contentType: String?): Boolean {
        val mime = contentType?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT) ?: return false
        val allowed = mimeTypes[extension.lowercase(Locale.ROOT)] ?: return false
        return mime in allowed || mime == "application/octet-stream" || mime == "binary/octet-stream"
    }

    /** The nonce comes from UUID at the adapter boundary; preserves the validated extension. */
    fun filename(file: DirectFile, nonce: String): String {
        require(nonce.matches(Regex("[a-zA-Z0-9-]{1,40}")))
        val stem = file.basename.substringBeforeLast('.').replace(Regex("[^a-zA-Z0-9_-]"), "_")
            .trim('_', '-').take(60).ifBlank { "file" }
        return "$stem-$nonce.${file.extension}"
    }

    fun progress(downloaded: Long, total: Long, completed: Boolean): Float? = when {
        completed -> 1f
        total <= 0 -> null
        else -> (downloaded.coerceAtLeast(0).toDouble() / total).coerceIn(0.0, 0.99).toFloat()
    }
}
