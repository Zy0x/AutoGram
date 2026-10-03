package com.autogram.app.features.cloudtransfer

import org.junit.Assert.*
import org.junit.Test

class DownloadPresentationTest {
    @Test fun actualFilenameAndMimeRemainUsableWithoutQualityInference() {
        val metadata = DownloadPresentation("Video keluarga 01.mp4", "video/mp4")
        assertEquals("Video keluarga 01.mp4", metadata.outputName())
        assertEquals("video/mp4", metadata.outputMime())
    }
    @Test fun untrustedListingNameCannotBecomeAPathOrInvalidPickerName() {
        assertEquals(".._file__.mp4", DownloadPresentation("../file\n\\.mp4", "video/mp4").outputName())
        assertEquals("download.bin", DownloadPresentation("..", "video/mp4").outputName())
        assertEquals(255, DownloadPresentation("x".repeat(1000), "video/mp4").outputName().length)
        assertEquals("application/octet-stream", DownloadPresentation("name.mp4", "not a mime").outputMime())
    }
}
