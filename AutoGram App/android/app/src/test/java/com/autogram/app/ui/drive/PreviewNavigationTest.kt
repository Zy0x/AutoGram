package com.autogram.app.ui.drive

import com.autogram.app.ui.drive.preview.previewNavigationItems
import com.autogram.app.ui.drive.preview.previewItemKey
import com.autogram.app.ui.drive.preview.scopedPreviewItems
import com.autogram.app.viewmodel.*
import org.junit.Assert.*
import org.junit.Test

class PreviewNavigationTest {
    @Test fun sameMessageIdDoesNotCollideAcrossScopesAndMissingSelectionIsRetained() {
        val selected = photo("1", 1)
        val other = photo("1", 2, account = "two")
        assertNotEquals(previewItemKey(selected), previewItemKey(other))
        assertEquals(listOf(selected), scopedPreviewItems(selected, listOf(other)))
        assertEquals(listOf(selected), scopedPreviewItems(selected, listOf(selected, selected)))
    }
    @Test fun usesFilenamePolicyAndDoesNotLeakOtherTopicCards() {
        val selected = photo("1", 1).copy(topicId = 10)
        val namedVideo = photo("2", 2).copy(topicId = 10, mimeType = "application/octet-stream", name = "movie.mp4")
        val otherTopic = photo("3", 3).copy(topicId = 11)
        assertEquals(listOf(namedVideo, selected), previewNavigationItems(
            DriveUiState(items = listOf(selected, namedVideo, otherTopic), activeTopicId = 10), selected))
    }
    private fun photo(id: String, time: Long, account: String = "one", peer: String = "cloud") =
        DriveFileItem(id, id, 100, "image/jpeg", false, time, telegramCategory = "photo",
            cloudAccountId = account, cloudPeerId = peer, cloudMessageId = id.toInt())

    @Test fun followsVisibleNewestFirstAndFiltersFoldersFormatsAndScope() {
        val first = photo("1", 10)
        val newer = photo("2", 20)
        val items = listOf(first, newer, photo("3", 30, "other"), photo("4", 40, peer = "other"),
            photo("5", 50).copy(isFolder = true), photo("6", 60).copy(mimeType = "application/zip"))
        assertEquals(listOf("2", "1"), previewNavigationItems(DriveUiState(items = items), first).map { it.id })
    }

    @Test fun respectsActiveGalleryFilterWithoutLosingSelectedUnsupportedFile() {
        val image = photo("1", 10)
        val video = photo("2", 20).copy(mimeType = "video/mp4", telegramCategory = "video")
        val state = DriveUiState(items = listOf(image, video), mediaFilter = DriveMediaFilter.IMAGES)
        assertEquals(listOf(image), previewNavigationItems(state, image))
        val unknown = photo("3", 30).copy(mimeType = "application/pdf")
        assertEquals(listOf(unknown, video, image), previewNavigationItems(
            DriveUiState(items = listOf(image, video, unknown)), unknown))
    }
}
