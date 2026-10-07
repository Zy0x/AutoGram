package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.topics.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CloudTopicsStoreTest {
    private val scope = CloudScope("fixture-A", "forum-1")
    private val cursor = TopicCursor(1000, 90, 7)
    private class Service(val block: suspend (CloudScope, TopicCursor?) -> TopicsPage) : CloudTopicsService {
        override suspend fun topics(scope: CloudScope, cursor: TopicCursor?) = block(scope, cursor)
    }
    private fun page(scope: CloudScope, id: Long, next: TopicCursor? = null) =
        TopicsPage(scope.accountId, scope.peerId, listOf(CloudTopic(id, "fixture")), next)

    @Test fun initialStateHasNoInventedGeneralTopicAndPaginationUsesServerCursor() = runBlocking {
        val calls = mutableListOf<TopicCursor?>()
        val store = CloudTopicsStore(Service { s, c ->
            calls.add(c)
            if (c == null) page(s, 7, cursor) else page(s, 8)
        })
        store.scope(scope)
        assertTrue(store.state.value.items.isEmpty())
        store.load(); store.load(true); store.load(true)
        assertEquals(listOf(null, cursor), calls)
        assertEquals(listOf(7L, 8L), store.state.value.items.map { it.id })
    }
    @Test fun lateResponseCannotCrossLocationOrAccountABA() = runBlocking {
        val old = CompletableDeferred<TopicsPage>()
        var calls = 0
        val store = CloudTopicsStore(Service { s, _ -> if (++calls == 1) old.await() else page(s, 8) })
        store.scope(scope)
        val pending = launch(start = CoroutineStart.UNDISPATCHED) { store.load() }
        store.scope(CloudScope("fixture-B", "forum-2")); store.scope(scope); store.load()
        old.complete(page(scope, 7)); pending.join()
        assertEquals(8L, store.state.value.items.single().id)
    }
    @Test fun wrongScopeAndRepeatedCursorAreErrorsNotSuccessfulRows() = runBlocking {
        var wrongOwner = true
        val store = CloudTopicsStore(Service { s, _ ->
            if (wrongOwner) page(s.copy(peerId = "wrong"), 9) else page(s, 7, cursor)
        })
        store.scope(scope); store.load()
        assertEquals("account_changed", store.state.value.error)
        assertTrue(store.state.value.items.isEmpty())
        wrongOwner = false; store.load(); store.load(true)
        assertEquals("cloud_cursor_invalid", store.state.value.error)
        assertEquals(7L, store.state.value.items.single().id)
    }
    @Test fun floodWaitPreventsRetryUntilServerCooldownAndCancelIsNotFailure() = runBlocking {
        var time = 1000L
        var calls = 0
        val pending = CompletableDeferred<TopicsPage>()
        val store = CloudTopicsStore(Service { _, _ ->
            if (++calls == 1) throw CloudFailure("flood_wait", 5) else pending.await()
        }, { time })
        store.scope(scope); store.load(); store.load()
        store.scope(scope.copy(peerId = "forum-2")); store.load()
        assertEquals("flood_wait", store.state.value.error)
        assertEquals(1, calls)
        assertEquals(6000L, store.state.value.retryAtMs)
        time = 6000
        val job = launch(start = CoroutineStart.UNDISPATCHED) { store.load() }
        job.cancelAndJoin()
        assertFalse(store.state.value.loading)
        assertNull(store.state.value.error)
        assertTrue(job.isCancelled)
    }
}
