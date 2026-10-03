package com.autogram.app.features.gate

import com.autogram.app.features.auth.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class VerifiedGateSnapshotTest {
    private class SnapshotService(var inventory: List<AuthAccount>) : AuthService {
        var selections = 0
        override suspend fun accounts() = inventory
        override suspend fun select(id: String): AuthAccount { selections++; error("Snapshot must never select") }
        override suspend fun configured() = true
        override suspend fun configure(id: Int, hash: String) = error("not used")
        override suspend fun create(phone: String?): String = error("not used")
        override suspend fun begin(id: String, qr: Boolean): LoginChallenge = error("not used")
        override suspend fun code(id: String, code: String): LoginChallenge = error("not used")
        override suspend fun password(id: String, password: String): LoginChallenge = error("not used")
        override suspend fun resend(id: String): LoginChallenge = error("not used")
        override suspend fun poll(id: String): LoginChallenge = error("not used")
        override suspend fun logout(id: String) = error("not used")
        override suspend fun lastSelected(): String? = null
        override fun cancel(id: String) = error("not used")
    }

    @Test fun repeatedSelectionEventsDoNotTriggerSelectionLoop() = runBlocking {
        val account = AuthAccount("fixture", "Fixture", null, true, true)
        val service = SnapshotService(listOf(account))
        repeat(5) { assertEquals(GateState.Authenticated(account), verifiedGateSnapshot(service)) }
        assertEquals(0, service.selections)
    }

    @Test fun filesAndUnverifiedFlagsNeverOpenTheGate() = runBlocking {
        val service = SnapshotService(listOf(AuthAccount("fixture", "Fixture", null, false, true)))
        assertTrue(verifiedGateSnapshot(service) is GateState.SavedAccounts)
        service.inventory = emptyList()
        assertTrue(verifiedGateSnapshot(service) is GateState.SavedAccounts)
        assertEquals(0, service.selections)
    }

    @Test fun accountSwitchUsesTheNewVerifiedIdentityAndRevocationClosesGate() = runBlocking {
        val first = AuthAccount("one", "One", null, true, false)
        val second = AuthAccount("two", "Two", null, true, true)
        val service = SnapshotService(listOf(first, second))
        assertEquals(GateState.Authenticated(second), verifiedGateSnapshot(service))
        service.inventory = listOf(second.copy(active = false, verified = false))
        assertTrue(verifiedGateSnapshot(service) is GateState.SavedAccounts)
    }
}
