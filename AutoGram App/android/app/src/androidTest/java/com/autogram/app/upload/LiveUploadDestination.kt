package com.autogram.app.upload

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.junit.Assert.*
import uniffi.autogram_android_bridge.*

/** No writes. Resolve the approved unique forum/topic before issuing any fixture send. */
internal data class LiveUploadDestination(val account: String, val peer: String, val topic: Int)

internal suspend fun resolveUploadDestination(): LiveUploadDestination {
    check(InstrumentationRegistry.getArguments().getString("autogramUploadFixture") == "GudangTes") {
        "Dedicated Telegram fixture test requires explicit opt-in."
    }
    val account = lastSelectedAccount() ?: error("No previously selected account")
    val identity = selectAuthorizedAccount(account)
    assertTrue(identity.verified && identity.active)
    assertEquals(account, identity.id)
    val forums = linkedMapOf<String, NativeCloudDialog>()
    val dialogCursors = mutableSetOf<String>()
    var cursor: String? = null
    var dialogPages = 0
    do {
        currentCoroutineContext().ensureActive()
        check(++dialogPages <= 20) { "Dialog inspection exceeded its bound; no write authorized" }
        val page = listCloudDialogs(account, cursor)
        assertEquals(account, page.accountId)
        page.items.filter { it.kind == "forum" &&
            (it.title == "#Gudang" || it.title == "#Gudang [TD]") }.forEach { forums[it.id] = it }
        cursor = page.nextCursor
        if (cursor != null) check(dialogCursors.add(cursor!!)) { "Repeated dialog cursor" }
    } while (cursor != null)
    check(forums.size == 1) { "Approved forum is missing or ambiguous; no fixture was sent" }
    val forum = forums.values.single()
    check(forum.id.toLongOrNull()?.let { it < -1_000_000_000_000L } == true) { "Invalid forum identity" }
    var topicCursor: NativeTopicCursor? = null
    val topicCursors = mutableSetOf<NativeTopicCursor>()
    val topics = linkedMapOf<Int, NativeCloudTopic>()
    var topicPages = 0
    do {
        currentCoroutineContext().ensureActive()
        check(++topicPages <= 20) { "Topic inspection exceeded its bound; no write authorized" }
        val page = listCloudTopics(account, forum.id, topicCursor)
        assertEquals(account, page.accountId); assertEquals(forum.id, page.peerId)
        page.topics.filter { it.title == "Tes" }.forEach { topics[it.id] = it }
        topicCursor = page.next
        if (topicCursor != null) check(topicCursors.add(topicCursor!!)) { "Repeated topic cursor" }
    } while (topicCursor != null)
    check(topics.size == 1) { "Approved topic is missing or ambiguous; no fixture was sent" }
    val topic = topics.values.single()
    check(topic.id > 0 && !topic.closed) { "Approved topic is invalid or closed" }
    assertEquals("The selected account changed before the first write", account, lastSelectedAccount())
    return LiveUploadDestination(account, forum.id, topic.id)
}
