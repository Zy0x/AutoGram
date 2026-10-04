package com.autogram.app.ui.drive.gallery

import com.autogram.app.viewmodel.DriveFileItem
import com.autogram.app.viewmodel.DriveMediaFilter
import java.util.Calendar
import java.util.TimeZone

data class GallerySection(val key: String, val timestampMs: Long?, val items: List<DriveFileItem>)

/** Group actual timestamps in device time zone; never invent an unknown date. */
fun gallerySections(items: List<DriveFileItem>, zone: TimeZone = TimeZone.getDefault()): List<GallerySection> {
    val calendar = Calendar.getInstance(zone)
    return items.sortedWith(compareByDescending<DriveFileItem> { it.modifiedMs }.thenBy { it.id })
        .groupBy { item ->
            if (item.modifiedMs <= 0) "unknown" else {
                calendar.timeInMillis = item.modifiedMs
                "${calendar.get(Calendar.YEAR)}-${calendar.get(Calendar.DAY_OF_YEAR)}"
            }
        }.map { (key, records) -> GallerySection(key, records.first().modifiedMs.takeIf { it > 0 }, records) }
}

fun galleryItems(
    items: List<DriveFileItem>,
    query: String,
    filter: DriveMediaFilter,
    activeTopicId: Long? = null
): List<DriveFileItem> =
    items.filter { item ->
        val matchesTopic = activeTopicId == null || item.topicId == null || item.topicId == activeTopicId
        val matchesSearch = item.cloudAccountId != null || query.isBlank() || item.name.contains(query, true)
        val category = item.telegramCategory.lowercase(java.util.Locale.ROOT)
        val mime = item.mimeType.lowercase(java.util.Locale.ROOT)
        matchesTopic && matchesSearch && when (filter) {
            DriveMediaFilter.ALL -> true
            DriveMediaFilter.MEDIA -> !item.isFolder && category in setOf("photo", "video", "gif")
            DriveMediaFilter.IMAGES -> !item.isFolder && category == "photo"
            DriveMediaFilter.VIDEOS -> !item.isFolder && category == "video"
            DriveMediaFilter.AUDIO -> !item.isFolder && (category == "audio" || mime.startsWith("audio/"))
            DriveMediaFilter.DOCUMENTS -> !item.isFolder && category != "sticker" && item.deliveryKind.equals("document", true)
            DriveMediaFilter.STICKERS -> !item.isFolder && category == "sticker"
        }
    }
