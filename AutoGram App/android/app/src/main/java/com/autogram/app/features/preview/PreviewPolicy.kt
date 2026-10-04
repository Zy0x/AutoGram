package com.autogram.app.features.preview

import com.autogram.app.R
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

enum class PreviewKind { IMAGE, VIDEO, AUDIO, TEXT, UNSUPPORTED }

val CODE_TEXT_EXTENSIONS = setOf(
    "txt", "md", "markdown", "json", "xml", "html", "htm", "css", "js", "ts", "jsx", "tsx",
    "py", "rs", "kt", "kts", "java", "c", "cpp", "h", "hpp", "cs", "go", "rb", "php",
    "sql", "sh", "bash", "zsh", "ps1", "bat", "cmd", "yaml", "yml", "toml", "ini", "conf",
    "env", "log", "properties", "gradle"
)

fun previewKind(mime: String, filename: String = ""): PreviewKind = when {
    mime.lowercase().startsWith("image/") -> PreviewKind.IMAGE
    mime.lowercase().startsWith("video/") -> PreviewKind.VIDEO
    mime.lowercase().startsWith("audio/") -> PreviewKind.AUDIO
    mime.lowercase().startsWith("text/") ||
        mime.lowercase() in setOf("application/json", "application/xml", "application/javascript", "application/x-sh") ||
        filename.substringAfterLast('.', "").lowercase() in CODE_TEXT_EXTENSIONS -> PreviewKind.TEXT
    else -> PreviewKind.UNSUPPORTED
}

fun mediaKindLabel(mime: String, filename: String = ""): Int = when (previewKind(mime, filename)) {
    PreviewKind.IMAGE -> R.string.real_image
    PreviewKind.VIDEO -> R.string.real_video
    PreviewKind.AUDIO -> R.string.real_audio
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
