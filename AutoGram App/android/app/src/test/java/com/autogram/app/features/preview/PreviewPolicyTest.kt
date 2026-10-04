package com.autogram.app.features.preview

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class PreviewPolicyTest {
    @Test fun typesComeFromContentMetadataNotFilenamesOrFileSize() {
        assertEquals(PreviewKind.VIDEO, previewKind("video/mp4"))
        assertEquals(PreviewKind.VIDEO, previewKind("video/x-matroska", "movie.mkv"))
        assertEquals(PreviewKind.VIDEO, previewKind("video/webm", "clip.webm"))
        assertEquals(PreviewKind.AUDIO, previewKind("audio/wav"))
        assertEquals(PreviewKind.AUDIO, previewKind("audio/flac", "song.flac"))
        assertEquals(PreviewKind.IMAGE, previewKind("image/jpeg"))
        assertEquals(PreviewKind.PDF, previewKind("application/pdf", "document.pdf"))
        assertEquals(PreviewKind.MARKDOWN, previewKind("text/markdown", "README.md"))
        assertEquals(PreviewKind.CODE, previewKind("text/x-kotlin", "App.kt"))
        assertEquals(PreviewKind.LOG, previewKind("text/plain", "app.log"))
        assertEquals(PreviewKind.TEXT, previewKind("application/json"))
        assertEquals(PreviewKind.JSON, previewKind("application/json", "config.json"))
        assertEquals(PreviewKind.UNSUPPORTED, previewKind("application/octet-stream"))
    }

    @Test fun textPreviewReadsActualUtf8Bytes() {
        val text = "Konten asli — 日本語"
        assertEquals(TextPreview(text, false), readTextPreview(ByteArrayInputStream(text.toByteArray())))
    }

    @Test fun largeDocumentsHaveBoundedPrefixReads() {
        val input = ByteArrayInputStream(ByteArray(1024 * 1024) { 65 })
        val preview = readTextPreview(input)
        assertTrue(preview.truncated)
        assertEquals(256 * 1024, preview.text.length)
        assertEquals(1024 * 1024 - 256 * 1024 - 1, input.available())
    }

    @Test fun cutMultibyteCharacterDoesNotCorruptPrefix() {
        val prefix = "a".repeat(256 * 1024 - 1)
        val preview = readTextPreview(ByteArrayInputStream((prefix + "€").toByteArray()))
        assertTrue(preview.truncated)
        assertEquals(prefix, preview.text)
    }

    @Test(expected = java.nio.charset.CharacterCodingException::class)
    fun binaryDataIsNotPresentedAsText() {
        readTextPreview(ByteArrayInputStream(byteArrayOf(0xFF.toByte(), 0xFE.toByte())))
    }
}
