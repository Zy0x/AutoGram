package com.autogram.app.features.preview

import com.autogram.app.R
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

enum class PreviewKind { IMAGE, VIDEO, AUDIO, TEXT, TABULAR, JSON, HEX, STICKER, UNSUPPORTED }

val CODE_TEXT_EXTENSIONS = setOf(
    "txt", "md", "markdown", "xml", "html", "htm", "css", "js", "ts", "jsx", "tsx",
    "py", "rs", "kt", "kts", "java", "c", "cpp", "h", "hpp", "cs", "go", "rb", "php",
    "sql", "sh", "bash", "zsh", "ps1", "bat", "cmd", "yaml", "yml", "toml", "ini", "conf",
    "env", "log", "properties", "gradle"
)

fun previewKind(mime: String, filename: String = ""): PreviewKind {
    val m = mime.lowercase()
    val ext = filename.substringAfterLast('.', "").lowercase()
    return when {
        ext == "tgs" || m == "application/x-tgsticker" -> PreviewKind.STICKER
        ext in setOf("csv", "tsv") || m in setOf("text/csv", "text/tab-separated-values") -> PreviewKind.TABULAR
        m.startsWith("image/") -> PreviewKind.IMAGE
        m.startsWith("video/") -> PreviewKind.VIDEO
        m.startsWith("audio/") -> PreviewKind.AUDIO
        m.startsWith("text/") ||
            m in setOf("application/json", "application/xml", "application/javascript", "application/x-sh") ||
            ext in CODE_TEXT_EXTENSIONS -> PreviewKind.TEXT
        ext in setOf("bin", "dat", "exe", "dll", "so", "hex", "rom") -> PreviewKind.HEX
        else -> PreviewKind.UNSUPPORTED
    }
}

fun mediaKindLabel(mime: String, filename: String = ""): Int = when (previewKind(mime, filename)) {
    PreviewKind.IMAGE -> R.string.real_image
    PreviewKind.VIDEO -> R.string.real_video
    PreviewKind.AUDIO -> R.string.real_audio
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
