package com.autogram.app.ui.home

import com.autogram.app.viewmodel.DriveFileItem
import org.junit.Assert.*
import org.junit.Test

class HomeMediaShelfTest {
    private fun item(id: Int, account: String? = "one", category: String = "photo") =
        DriveFileItem("$id", "fixture-$id", 100, "image/jpeg", false, id.toLong(),
            telegramCategory = category, cloudAccountId = account, cloudPeerId = "peer", cloudMessageId = id)

    @Test fun onlyActualAccountOwnedVisualsAppearInLoadedCollectionOrder() {
        val records = listOf(item(1), item(2, "two"), item(3, null), item(4, category = "file"),
            item(5, category = "video"), item(6).copy(cloudMessageId = null), item(7).copy(isFolder = true))
        assertEquals(listOf("5", "1"), homeMediaItems(records, "one").map { it.id })
        assertTrue(homeMediaItems(records, "").isEmpty())
    }
    @Test fun shelfNeverPretendsToBeGlobalHistoryAndStaysBounded() {
        assertEquals(listOf("12", "11", "10", "9", "8", "7"),
            homeMediaItems((1..12).map { item(it) }, "one").map { it.id })
        assertTrue(homeMediaItems(emptyList(), "one").isEmpty())
    }
}
