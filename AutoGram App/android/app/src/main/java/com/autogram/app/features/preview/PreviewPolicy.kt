package com.autogram.app.features.preview

import com.autogram.app.R
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

enum class PreviewKind {
    IMAGE,
    VIDEO,
    AUDIO,
    PDF,
    MARKDOWN,
    CODE,
    LOG,
    TABULAR,
    JSON,
    HEX,
    STICKER,
    TEXT,
    UNSUPPORTED
}

val VIDEO_EXTENSIONS = setOf(
    "mp4", "mkv", "webm", "avi", "mov", "3gp", "ts", "m2ts", "flv", "wmv", "ogv", "vob", "m4v"
)
val VIDEO_MIMES = setOf(
    "video/x-matroska", "video/mp4", "video/webm", "video/avi", "video/quicktime",
    "video/x-msvideo", "video/x-flv", "video/mp2t", "video/x-ms-wmv", "video/ogg", "video/3gpp"
)

val AUDIO_EXTENSIONS = setOf(
    "mp3", "flac", "ogg", "opus", "wav", "aac", "m4a", "wma", "alac", "aiff", "oga", "mid", "midi"
)
val AUDIO_MIMES = setOf(
    "audio/mpeg", "audio/ogg", "audio/opus", "audio/flac", "audio/x-wav", "audio/wav",
    "audio/aac", "audio/mp4", "audio/x-m4a", "audio/x-ms-wma", "audio/midi"
)

val CODE_EXTENSIONS = setOf(
    "kt", "kts", "rs", "py", "js", "jsx", "ts", "tsx", "java", "c", "cpp", "h", "hpp",
    "cs", "go", "rb", "php", "sql", "sh", "bash", "zsh", "ps1", "bat", "cmd", "yaml", "yml",
    "toml", "ini", "conf", "env", "gradle", "xml", "html", "htm", "css", "scss", "sass", "less",
    "properties", "proto", "graphql"
)

fun previewKind(mime: String, filename: String = ""): PreviewKind {
    val m = mime.lowercase()
    val ext = filename.substringAfterLast('.', "").lowercase()
    return when {
        ext == "tgs" || m == "application/x-tgsticker" -> PreviewKind.STICKER
        ext == "pdf" || m == "application/pdf" -> PreviewKind.PDF
        ext in setOf("md", "markdown") || m in setOf("text/markdown", "text/x-markdown") -> PreviewKind.MARKDOWN
        ext in setOf("log") || m == "text/x-log" -> PreviewKind.LOG
        ext in setOf("csv", "tsv") || m in setOf("text/csv", "text/tab-separated-values") -> PreviewKind.TABULAR
        ext == "json" -> PreviewKind.JSON
        ext in VIDEO_EXTENSIONS || m.startsWith("video/") || m in VIDEO_MIMES -> PreviewKind.VIDEO
        ext in AUDIO_EXTENSIONS || m.startsWith("audio/") || m in AUDIO_MIMES -> PreviewKind.AUDIO
        m.startsWith("image/") -> PreviewKind.IMAGE
        ext in CODE_EXTENSIONS || m in setOf("application/javascript", "application/xml", "application/x-sh") -> PreviewKind.CODE
        ext in setOf("bin", "dat", "exe", "dll", "so", "hex", "rom") -> PreviewKind.HEX
        ext == "txt" || m.startsWith("text/") || m == "application/json" -> PreviewKind.TEXT
        else -> PreviewKind.UNSUPPORTED
    }
}

fun mediaKindLabel(mime: String, filename: String = ""): Int = when (previewKind(mime, filename)) {
    PreviewKind.IMAGE -> R.string.real_image
    PreviewKind.VIDEO -> R.string.real_video
    PreviewKind.AUDIO -> R.string.real_audio
    PreviewKind.PDF -> R.string.preview_pdf_title
    PreviewKind.MARKDOWN -> R.string.preview_markdown_title
    PreviewKind.CODE -> R.string.preview_code_title
    PreviewKind.LOG -> R.string.preview_log_title
    PreviewKind.TABULAR -> R.string.preview_tabular_title
    PreviewKind.JSON -> R.string.preview_json_title
    PreviewKind.STICKER -> R.string.preview_sticker_title
    PreviewKind.HEX -> R.string.preview_hex_title
    else -> if (mime.lowercase() in setOf("application/zip", "application/x-7z-compressed") || filename.lowercase().endsWith(".zip"))
        R.string.real_archive else R.string.real_file
}

data class TextPreview(val text: String, val truncated: Boolean)

/** Bounded UTF-8 preview, never downloads or reads a full large document. */
fun readTextPreview(input: InputStream): TextPreview {
    val limit = 256 * 1024
    val buffer = ByteArray(limit + 1)
    var count = 0
    while (count < buffer.size) {
        val read = input.read(buffer, count, buffer.size - count)
        if (read < 0) break
        if (read == 0) {
            val next = input.read()
            if (next < 0) break
            buffer[count++] = next.toByte()
        } else count += read
    }
    // Ignore only an incomplete trailing character in a deliberately truncated prefix.
    val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
    val bytes = ByteBuffer.wrap(buffer, 0, count.coerceAtMost(limit))
    val output = java.nio.CharBuffer.allocate(limit)
    val result = decoder.decode(bytes, output, count <= limit)
    if (result.isError) result.throwException()
    output.flip()
    return TextPreview(output.toString(), count > limit)
}
