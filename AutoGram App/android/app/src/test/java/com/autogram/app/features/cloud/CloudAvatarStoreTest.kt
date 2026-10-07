package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.avatars.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CloudAvatarStoreTest {
    private val photo = CloudLocation("7", "chat", "forum", "photo7")
    @Test fun duplicateVisibleLoadsAreCoalescedAndCached() = runBlocking {
        val pending = CompletableDeferred<ByteArray>()
        var calls = 0
        val store = CloudAvatarStore(CloudAvatarService { a, peer, key ->
            assertEquals("A", a); assertEquals("7", peer); assertEquals("photo7", key)
            calls++; pending.await()
        })
        store.scope("A")
        val job = launch(start = CoroutineStart.UNDISPATCHED) { store.load("A", photo) }
        store.load("A", photo); pending.complete(byteArrayOf(1)); job.join()
        store.load("A", photo)
        assertEquals(1, calls)
        assertArrayEquals(byteArrayOf(1), store.state.value.photos[AvatarKey("7", "photo7")])
    }
    @Test fun accountABARejectsLateBytesAndOldFinallyCannotRemoveNewRequest() = runBlocking {
        val pending = CompletableDeferred<ByteArray>()
        val store = CloudAvatarStore(CloudAvatarService { _, _, _ -> pending.await() })
        store.scope("A")
        val old = launch(start = CoroutineStart.UNDISPATCHED) { store.load("A", photo) }
        store.scope("B"); store.scope("A")
        pending.complete(byteArrayOf(1)); old.join()
        assertTrue(store.state.value.photos.isEmpty())
        store.load("B", photo); assertTrue(store.state.value.photos.isEmpty())
    }
    @Test fun photosWithoutServerIdentityDoNotCallTransportAndOversizeIsRejected() = runBlocking {
        var calls = 0
        val store = CloudAvatarStore(CloudAvatarService { _, _, _ -> calls++; ByteArray(256 * 1024 + 1) })
        store.scope("A"); store.load("A", photo.copy(photoKey = null)); assertEquals(0, calls)
        store.load("A", photo); assertEquals(1, calls); assertTrue(store.state.value.photos.isEmpty())
    }
    @Test fun photoCooldownDoesNotResetOnScopeOrConcurrentQueueAndEndsNaturally() = runBlocking {
        var time = 1000L; var calls = 0
        val store = CloudAvatarStore(CloudAvatarService { _, _, _ -> calls++; throw CloudFailure("flood_wait", 40) }, { time })
        store.scope("A"); store.load("A", photo); store.load("A", photo.copy(id = "8"))
        store.scope("A"); store.load("A", photo)
        assertEquals(1, calls); assertTrue(store.state.value.photos.isEmpty())
        time = 41000; store.load("A", photo); assertEquals(2, calls)
    }
    @Test fun retainedPhotoMemoryIsBoundedAndChangedPhotoHasDifferentKey() = runBlocking {
        val store = CloudAvatarStore(CloudAvatarService { _, _, _ -> byteArrayOf(1) })
        store.scope("A")
        repeat(40) { store.load("A", photo.copy(id = it.toString())) }
        assertEquals(32, store.state.value.photos.size)
        store.load("A", photo.copy(photoKey = "new-photo"))
        assertTrue(AvatarKey("7", "new-photo") in store.state.value.photos)
        assertEquals(32, store.state.value.photos.size)
    }
}
