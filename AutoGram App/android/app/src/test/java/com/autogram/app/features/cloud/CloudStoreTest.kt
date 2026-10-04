package com.autogram.app.features.cloud

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CloudStoreTest {
    private val scope = CloudScope("A", "me")
    private fun item(id: Int) = CloudMedia(id, "file", 20, "text/plain", 1, "document", "file")
    private class Service(
        val read: suspend (CloudScope, Int, String) -> CloudMediaPage,
        val dialogs: suspend (String, String?) -> CloudLocationsPage = { account, _ -> CloudLocationsPage(account, emptyList(), null) },
        val thumbProvider: suspend (CloudScope, List<Int>, String) -> List<CloudThumbnail> = { _, _, _ -> emptyList() }
    ) : CloudService {
        override suspend fun media(scope: CloudScope, before: Int, query: String) = read(scope, before, query)
        override suspend fun locations(accountId: String, cursor: String?) = dialogs(accountId, cursor)
        override suspend fun thumbnails(scope: CloudScope, messageIds: List<Int>, quality: String) = thumbProvider(scope, messageIds, quality)
    }

    @Test fun accountABARejectsEarlierCompletionEvenWithoutTransportCancellation() = runBlocking {
        val pending = CompletableDeferred<CloudMediaPage>()
        var calls = 0
        val store = CloudStore(Service({ s, _, _ ->
            if (++calls == 1) pending.await() else CloudMediaPage(s.accountId, s.peerId, listOf(item(2)), null)
        }))
        store.scope(scope)
        val old = launch(start = CoroutineStart.UNDISPATCHED) { store.media() }
        store.scope(CloudScope("B", "me")); store.scope(scope); store.media()
        pending.complete(CloudMediaPage("A", "me", listOf(item(1)), null)); old.join()
        assertEquals(listOf(2), store.state.value.items.map { it.id })
    }

    @Test fun queryChangeRejectsOldSearch() = runBlocking {
        val pending = CompletableDeferred<CloudMediaPage>()
        val store = CloudStore(Service({ s, _, q ->
            if (q.isEmpty()) pending.await() else CloudMediaPage(s.accountId, s.peerId, listOf(item(8)), null)
        }))
        store.scope(scope)
        val old = launch(start = CoroutineStart.UNDISPATCHED) { store.media() }
        store.query("caption"); store.media()
        pending.complete(CloudMediaPage("A", "me", listOf(item(1)), null)); old.join()
        assertEquals("caption", store.state.value.query)
        assertEquals(8, store.state.value.items.single().id)
    }

    @Test fun emptyMediaPageCanContinueAndOverlapsAreDeduplicated() = runBlocking {
        val offsets = mutableListOf<Int>()
        val store = CloudStore(Service({ s, before, _ ->
            offsets.add(before)
            when (before) {
                0 -> CloudMediaPage(s.accountId, s.peerId, emptyList(), 200)
                200 -> CloudMediaPage(s.accountId, s.peerId, listOf(item(190), item(180)), 170)
                else -> CloudMediaPage(s.accountId, s.peerId, listOf(item(180), item(160)), null)
            }
        }))
        store.scope(scope); store.media(); store.media(true); store.media(true); store.media(true)
        assertEquals(listOf(0, 200, 170), offsets)
        assertEquals(listOf(190, 180, 160), store.state.value.items.map { it.id })
    }

    @Test fun wrongScopeAndNonProgressingCursorFailWithoutPublishingItems() = runBlocking {
        var wrong = true
        val store = CloudStore(Service({ s, _, _ ->
            if (wrong) CloudMediaPage("B", s.peerId, listOf(item(1)), null)
            else CloudMediaPage(s.accountId, s.peerId, listOf(item(2)), 0)
        }))
        store.scope(scope); store.media()
        assertEquals("account_changed", store.state.value.error)
        assertTrue(store.state.value.items.isEmpty())
        wrong = false; store.media()
        assertEquals("cloud_cursor_invalid", store.state.value.error)
        assertTrue(store.state.value.items.isEmpty())
    }

    @Test fun floodWaitBlocksRequestsUntilDeadlineAndIsolatedAccountClearsIt() = runBlocking {
        var time = 1000L
        var calls = 0
        val store = CloudStore(Service({ s, _, _ ->
            if (++calls == 1) throw CloudFailure("flood_wait", 5)
            CloudMediaPage(s.accountId, s.peerId, emptyList(), null)
        }), { time })
        store.scope(scope); store.media(); store.media()
        assertEquals(1, calls); assertEquals(6000L, store.state.value.retryAtMs)
        time = 5999; store.media(); assertEquals(1, calls)
        time = 6000; store.media(); assertEquals(2, calls)
        store.scope(CloudScope("B", "me")); assertEquals(0L, store.state.value.retryAtMs)
    }

    @Test fun failedAppendRetainsMediaAndCursorAndDoesNotLeakExceptionText() = runBlocking {
        val store = CloudStore(Service({ s, before, _ ->
            if (before != 0) error("secret-url-or-path")
            CloudMediaPage(s.accountId, s.peerId, listOf(item(10)), 9)
        }))
        store.scope(scope); store.media(); store.media(true)
        assertEquals(10, store.state.value.items.single().id)
        assertEquals(9, store.state.value.nextOffset)
        assertEquals("cloud_request_failed", store.state.value.error)
    }

    @Test fun cancellationDoesNotBecomeVisibleFailureOrResetNewLoading() = runBlocking {
        val pending = CompletableDeferred<CloudMediaPage>()
        val store = CloudStore(Service({ _, _, _ -> pending.await() }))
        store.scope(scope)
        val old = launch(start = CoroutineStart.UNDISPATCHED) { store.media() }
        val fresh = launch(start = CoroutineStart.UNDISPATCHED) { store.media() }
        old.cancelAndJoin(); assertTrue(store.state.value.loading)
        fresh.cancelAndJoin(); assertFalse(store.state.value.loading); assertNull(store.state.value.error)
    }

    @Test fun dialogResponseCannotCrossAccountAndSameAccountLocationsAreRetained() = runBlocking {
        val pending = CompletableDeferred<CloudLocationsPage>()
        val store = CloudStore(Service({ s, _, _ -> CloudMediaPage(s.accountId, s.peerId, emptyList(), null) },
            { a, _ -> if (a == "A") pending.await() else CloudLocationsPage(a, listOf(CloudLocation("3", "three", "user")), null) }))
        store.scope(scope)
        val old = launch(start = CoroutineStart.UNDISPATCHED) { store.locations() }
        store.scope(CloudScope("B", "me")); store.locations()
        pending.complete(CloudLocationsPage("A", listOf(CloudLocation("1", "one", "user")), "cursor")); old.join()
        store.scope(CloudScope("B", "3"))
        assertEquals(listOf("3"), store.state.value.locations.map { it.id })
        assertNull(store.state.value.locationsCursor)
    }

    @Test fun unauthenticatedScopeNeverCallsNativeService() = runBlocking {
        val store = CloudStore(Service({ _, _, _ -> error("must-not-call") }, { _, _ -> error("must-not-call") }))
        store.media(); store.locations()
        assertFalse(store.state.value.loading); assertNull(store.state.value.error)
    }

    @Test fun upgradeThumbnailsReplacesItemThumbnailBytesWithHigherResolution() = runBlocking {
        val initialBytes = byteArrayOf(1, 2)
        val upgradedBytes = byteArrayOf(9, 8, 7, 6)
        val store = CloudStore(Service(
            read = { s, _, _ -> CloudMediaPage(s.accountId, s.peerId, listOf(CloudMedia(42, "photo.jpg", 100, "image/jpeg", 1, "photo", "photo", thumbnailBytes = initialBytes)), null) },
            thumbProvider = { _, ids, q ->
                assertEquals("balanced", q)
                assertEquals(listOf(42), ids)
                listOf(CloudThumbnail(42, upgradedBytes))
            }
        ))
        store.scope(scope)
        store.media()
        assertArrayEquals(initialBytes, store.state.value.items.single().thumbnailBytes)

        store.upgradeThumbnails("balanced", listOf(42))
        assertArrayEquals(upgradedBytes, store.state.value.items.single().thumbnailBytes)
    }
}
