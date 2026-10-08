package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.topics.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CloudReadCacheTest {
    private val a = CloudScope("A", "forum", 7)
    private fun item(id: Int) = CloudMedia(id, "server", 20, "image/jpeg", 1, "native", "photo")
    private class Service : CloudService {
        var calls = 0
        var thumbnails = 0
        var wait = false
        override suspend fun media(scope: CloudScope, before: Int, query: String): CloudMediaPage {
            calls++
            if (wait) throw CloudFailure("flood_wait", 5)
            return CloudMediaPage(scope.accountId, scope.peerId,
                listOf(CloudMedia(if (before == 0) 42 else 41, query.ifEmpty { "server" }, 20,
                    "image/jpeg", 1, "native", "photo")), if (before == 0) 41 else null, scope.topicId)
        }
        override suspend fun locations(accountId: String, cursor: String?) = CloudLocationsPage(accountId, emptyList(), null)
        override suspend fun thumbnails(scope: CloudScope, messageIds: List<Int>, quality: String): List<CloudThumbnail> {
            thumbnails++; return messageIds.map { CloudThumbnail(it, byteArrayOf(3)) }
        }
    }
    @Test fun reopeningConfirmedTopicUsesCacheButExplicitRefreshStillCallsServer() = runBlocking {
        val service = Service(); val store = CloudStore(service)
        store.scope(a); store.media(preferCache = true)
        store.scope(a.copy(topicId = 8)); store.media(preferCache = true)
        store.scope(a); store.media(preferCache = true)
        assertEquals(2, service.calls); assertEquals(42, store.state.value.items.single().id)
        store.media(); assertEquals(3, service.calls)
        store.media(true); store.scope(a.copy(topicId = 8)); store.scope(a); store.media(preferCache = true)
        assertEquals(listOf(42, 41), store.state.value.items.map { it.id })
        assertNull(store.state.value.nextOffset)
    }
    @Test fun cacheNeverBypassesRealWaitForRefreshOrUncachedScope() = runBlocking {
        val service = Service(); val store = CloudStore(service, { 1000 })
        store.scope(a); store.media(); service.wait = true; store.media()
        assertEquals("flood_wait", store.state.value.error)
        store.media(preferCache = true)
        assertEquals(2, service.calls); assertNull(store.state.value.error)
        store.media(); assertEquals("flood_wait", store.state.value.error); assertEquals(2, service.calls)
        store.scope(a.copy(topicId = 8)); store.media(preferCache = true)
        assertEquals("flood_wait", store.state.value.error); assertEquals(2, service.calls)
    }
    @Test fun expiryAccountChangeAndQueryIdentityRequireFreshServerResults() = runBlocking {
        var time = 1000L
        val service = Service(); val store = CloudStore(service, { time })
        store.scope(a); store.media(preferCache = true)
        store.query("different"); store.media(preferCache = true)
        assertEquals("different", store.state.value.items.single().name)
        store.scope(a); store.media(preferCache = true); assertEquals(2, service.calls)
        time = 301_000; store.media(preferCache = true); assertEquals(3, service.calls)
        store.scope(a.copy(accountId = "B")); store.scope(a); store.media(preferCache = true)
        assertEquals(4, service.calls)
    }
    @Test fun thumbnailReuseIsPeerAccountAndQualityScopedAndRejectsHiddenIds() = runBlocking {
        val service = Service(); val store = CloudStore(service)
        store.scope(a); store.media()
        store.upgradeThumbnails("balanced", listOf(42, 999)); store.upgradeThumbnails("balanced", listOf(42))
        assertEquals(1, service.thumbnails)
        store.scope(a.copy(topicId = 8)); store.media(); store.upgradeThumbnails("balanced", listOf(42))
        assertEquals(1, service.thumbnails)
        store.upgradeThumbnails("sharp", listOf(42)); assertEquals(2, service.thumbnails)
        store.scope(a.copy(peerId = "other")); store.media(); store.upgradeThumbnails("balanced", listOf(42))
        assertEquals(3, service.thumbnails)
        store.scope(a.copy(accountId = "B")); store.media(); store.upgradeThumbnails("balanced", listOf(42))
        assertEquals(4, service.thumbnails)
    }
    @Test fun duplicatePendingMediaCallsDoNotCreateParallelReads() = runBlocking {
        val pending = CompletableDeferred<CloudMediaPage>()
        var calls = 0
        val service = object : CloudService {
            override suspend fun media(scope: CloudScope, before: Int, query: String): CloudMediaPage { calls++; return pending.await() }
            override suspend fun locations(accountId: String, cursor: String?) = CloudLocationsPage(accountId, emptyList(), null)
            override suspend fun thumbnails(scope: CloudScope, messageIds: List<Int>, quality: String) = emptyList<CloudThumbnail>()
        }
        val store = CloudStore(service); store.scope(a)
        val first = launch(start = CoroutineStart.UNDISPATCHED) { store.media() }
        store.media(); assertEquals(1, calls)
        pending.complete(CloudMediaPage(a.accountId, a.peerId, listOf(item(42)), null, a.topicId)); first.join()
    }
    @Test fun optionalThumbnailUpgradeCannotExtendOldMediaMetadataLifetime() = runBlocking {
        var time = 1000L
        val service = Service(); val store = CloudStore(service, { time })
        store.scope(a); store.media(preferCache = true)
        time = 300_000; store.upgradeThumbnails("balanced", listOf(42))
        time = 301_000; store.media(preferCache = true)
        assertEquals(2, service.calls)
    }
    @Test fun topicCachePreservesServerCursorAndDoesNotCrossAccounts() = runBlocking {
        var calls = 0
        var time = 1000L
        val cursor = TopicCursor(1, 99, 7)
        val service = object : CloudTopicsService {
            override suspend fun topics(scope: CloudScope, cursor: TopicCursor?): TopicsPage {
                calls++; return TopicsPage(scope.accountId, scope.peerId, listOf(CloudTopic(7, "server")), if (cursor == null) this@CloudReadCacheTest.cursorFixture() else null)
            }
        }
        val store = CloudTopicsStore(service, { time })
        store.scope(a); store.load(preferCache = true)
        store.scope(a.copy(peerId = "other")); store.load(preferCache = true)
        store.scope(a); store.load(preferCache = true)
        assertEquals(2, calls); assertEquals(cursor, store.state.value.next)
        store.load(); assertEquals(3, calls)
        time = 301_000; store.load(preferCache = true); assertEquals(4, calls)
        store.scope(a.copy(accountId = "B")); store.scope(a); store.load(preferCache = true)
        assertEquals(5, calls)
    }
    private fun cursorFixture() = TopicCursor(1, 99, 7)
}
