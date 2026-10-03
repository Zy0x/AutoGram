package com.autogram.app.ui.drive.gallery

import com.autogram.app.viewmodel.*
import org.junit.Assert.*
import org.junit.Test
import java.util.TimeZone

class GallerySectionsTest {
    private fun item(id: String, time: Long, category: String = "photo", cloud: Boolean = false) =
        DriveFileItem(id, "$id.bin", 120, "application/octet-stream", false, time,
            telegramCategory = category, cloudAccountId = if (cloud) "test-only" else null)

    @Test fun datesAreChronologicalAndUnknownIsNotToday() {
        val result = gallerySections(listOf(item("unknown", 0), item("old", 86400000), item("new", 172800000)),
            TimeZone.getTimeZone("UTC"))
        assertEquals(listOf("new", "old", "unknown"), result.map { it.items.single().id })
        assertNull(result.last().timestampMs)
        assertEquals("unknown", result.last().key)
    }

    @Test fun groupingUsesLocalCalendarNotUtcDivision() {
        val records = listOf(item("before", 86400000 - 60 * 60 * 1000), item("after", 86400000 + 60 * 60 * 1000))
        assertEquals(2, gallerySections(records, TimeZone.getTimeZone("UTC")).size)
        assertEquals(1, gallerySections(records, TimeZone.getTimeZone("Asia/Singapore")).size)
    }

    @Test fun sameDayKeepsAllItemsAndOrderIsDeterministic() {
        val result = gallerySections(listOf(item("b", 1000), item("a", 1000)))
        assertEquals(listOf("a", "b"), result.single().items.map { it.id })
        assertTrue(gallerySections(emptyList()).isEmpty())
    }

    @Test fun filtersUseTelegramCategoryRatherThanFilenameGuesses() {
        val records = listOf(item("movie.mp4", 1, "file"), item("actual", 2, "video"), item("sticker", 3, "sticker"))
        assertEquals(listOf("actual"), galleryItems(records, "", DriveMediaFilter.VIDEOS).map { it.id })
        assertEquals(listOf("sticker"), galleryItems(records, "", DriveMediaFilter.STICKERS).map { it.id })
    }

    @Test fun serverSearchMatchesCaptionsWithoutDiscardingReturnedFilenames() {
        assertEquals(1, galleryItems(listOf(item("server", 1, cloud = true)), "caption", DriveMediaFilter.ALL).size)
        assertTrue(galleryItems(listOf(item("local", 1)), "caption", DriveMediaFilter.ALL).isEmpty())
    }
}
