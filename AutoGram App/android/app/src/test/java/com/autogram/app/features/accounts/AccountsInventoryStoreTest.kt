package com.autogram.app.features.accounts

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class AccountsInventoryStoreTest {
    private val old = listOf(AccountSessionItem("Old", "unverified", "grammers"))
    private val fresh = listOf(AccountSessionItem("New", "unverified", "grammers"))

    @Test fun latestResultWinsWhenEarlierReadFinishesLast() = runBlocking {
        val first = CompletableDeferred<List<AccountSessionItem>>()
        var calls = 0
        val store = AccountsInventoryStore { if (++calls == 1) first.await() else fresh }
        val job = launch(start = CoroutineStart.UNDISPATCHED) { store.refresh() }
        assertTrue(store.state.value.isLoading)
        store.refresh()
        first.complete(old)
        job.join()
        assertEquals(fresh, store.state.value.sessions)
        assertFalse(store.state.value.isLoading)
    }

    @Test fun staleFailureCannotReplaceNewSuccess() = runBlocking {
        val first = CompletableDeferred<List<AccountSessionItem>>()
        var calls = 0
        val store = AccountsInventoryStore { if (++calls == 1) first.await() else fresh }
        val job = launch(start = CoroutineStart.UNDISPATCHED) { store.refresh() }
        store.refresh()
        first.completeExceptionally(IllegalStateException("private-path-must-not-leak"))
        job.join()
        assertEquals(fresh, store.state.value.sessions)
        assertNull(store.state.value.errorCode)
    }

    @Test fun failurePreservesLastGoodInventoryAndRecoveryClearsError() = runBlocking {
        var fail = false
        val store = AccountsInventoryStore { if (fail) error("private-path") else fresh }
        store.refresh()
        fail = true
        store.refresh()
        assertEquals(fresh, store.state.value.sessions)
        assertEquals("account_inventory_failed", store.state.value.errorCode)
        assertFalse(store.state.value.isLoading)
        fail = false
        store.refresh()
        assertNull(store.state.value.errorCode)
    }

    @Test fun missingNativeLibraryHasDistinctRecoverableError() = runBlocking {
        val store = AccountsInventoryStore { throw UnsatisfiedLinkError("private-path") }
        store.refresh()
        assertEquals("native_runtime_unavailable", store.state.value.errorCode)
        assertFalse(store.state.value.isLoading)
    }

    @Test fun staleCancellationDoesNotStopNewLoadingState() = runBlocking {
        val deferred = CompletableDeferred<List<AccountSessionItem>>()
        val store = AccountsInventoryStore { deferred.await() }
        val older = launch(start = CoroutineStart.UNDISPATCHED) { store.refresh() }
        val newer = launch(start = CoroutineStart.UNDISPATCHED) { store.refresh() }
        older.cancelAndJoin()
        assertTrue(store.state.value.isLoading)
        newer.cancelAndJoin()
        assertFalse(store.state.value.isLoading)
        assertNull(store.state.value.errorCode)
    }

    @Test fun staleSuccessCannotHideNewFailure() = runBlocking {
        val first = CompletableDeferred<List<AccountSessionItem>>()
        var calls = 0
        val store = AccountsInventoryStore { if (++calls == 1) first.await() else error("unavailable") }
        val older = launch(start = CoroutineStart.UNDISPATCHED) { store.refresh() }
        store.refresh()
        first.complete(old)
        older.join()
        assertTrue(store.state.value.sessions.isEmpty())
        assertEquals("account_inventory_failed", store.state.value.errorCode)
    }
}
