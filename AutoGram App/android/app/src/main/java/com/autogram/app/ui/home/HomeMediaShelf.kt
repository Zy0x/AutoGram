package com.autogram.app.ui.home

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.autogram.app.ui.drive.FileGridItem
import com.autogram.app.viewmodel.DriveFileItem

/** Latest within the loaded location only, not fabricated global/recent-playback history. */
fun homeMediaItems(items: List<DriveFileItem>, accountId: String): List<DriveFileItem> =
    items.filter { !it.isFolder && accountId.isNotBlank() && it.cloudAccountId == accountId &&
        it.cloudPeerId != null && it.cloudMessageId != null &&
        it.telegramCategory in setOf("photo", "video", "gif") }
        .sortedWith(compareByDescending<DriveFileItem> { it.modifiedMs }.thenBy { it.id }).take(6)

@Composable
fun HomeMediaShelf(items: List<DriveFileItem>, onOpen: (DriveFileItem) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        items.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                row.forEach { item ->
                    FileGridItem(item, false, { onOpen(item) }, { onOpen(item) },
                        Modifier.weight(1f), aspectRatio = 1f)
                }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}
