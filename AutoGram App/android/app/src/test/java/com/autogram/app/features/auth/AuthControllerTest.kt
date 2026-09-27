package com.autogram.app.features.auth

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class AuthControllerTest {
    private open class FakeAuth : AuthService {
        val cancelled = mutableListOf<String>()
        var selected = false
        var passwordUsed: String? = null
        override suspend fun configured() = true
        override suspend fun configure(id: Int, hash: String) {}
        override suspend fun accounts() = if (selected) listOf(AuthAccount("tg_1", "Test", null, true, true)) else emptyList()
        override suspend fun create(phone: String?) = "attempt"
        override suspend fun begin(id: String, qr: Boolean) = challenge(id, LoginPhase.CODE)
        override suspend fun code(id: String, code: String) = challenge(id, LoginPhase.PASSWORD)
        override suspend fun password(id: String, password: String): LoginChallenge {
            passwordUsed = password
            return challenge(id, LoginPhase.AUTHORIZED).copy(account = AuthAccount("tg_1", "Test", null, true, false))
        }
        override suspend fun resend(id: String) = challenge(id, LoginPhase.CODE)
        override suspend fun poll(id: String) = challenge(id, LoginPhase.QR)
        override suspend fun select(id: String): AuthAccount { selected = true; return accounts().single() }
        override suspend fun logout(id: String) { selected = false }
        override suspend fun lastSelected(): String? = null
        override fun cancel(id: String) { cancelled += id }
    }
    private fun runScenario(block: suspend CoroutineScope.() -> Unit) = runBlocking {
        val testScope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        try { testScope.block() } finally { testScope.cancel() }
    }
    @Test fun otpThenPasswordDoesNotResendAndOnlyVerifiedAccountBecomesActive() = runScenario {
        val service = FakeAuth()
        val controller = AuthController(service, this)
        controller.begin("+12345678901")
        assertEquals(LoginPhase.CODE, controller.state.value.challenge?.phase)
        controller.submit("12345")
        assertEquals(LoginPhase.PASSWORD, controller.state.value.challenge?.phase)
        controller.submit(" password with spaces ")
        assertEquals(" password with spaces ", service.passwordUsed)
        assertTrue(controller.state.value.accounts.single().active)
        assertNull(controller.state.value.challenge)
        assertTrue(service.cancelled.contains("attempt"))
    }
    @Test fun cancelledLateResponseNeverRestoresChallenge() = runScenario {
        val late = CompletableDeferred<LoginChallenge>()
        val service = object : FakeAuth() {
            override suspend fun begin(id: String, qr: Boolean) = withContext(NonCancellable) { late.await() }
        }
        val controller = AuthController(service, this)
        controller.begin("+12345678901")
        controller.cancel()
        late.complete(challenge("attempt", LoginPhase.CODE))
        yield()
        assertNull(controller.state.value.challenge)
        assertNull(controller.state.value.attemptId)
        assertFalse(controller.state.value.busy)
        assertEquals(listOf("attempt"), service.cancelled)
    }
    @Test fun cancellingDuringCreationCancelsTheReturnedNativeHandle() = runScenario {
        val created = CompletableDeferred<String>()
        val service = object : FakeAuth() { override suspend fun create(phone: String?) = created.await() }
        val controller = AuthController(service, this)
        controller.begin(null)
        controller.cancel()
        created.complete("late-handle")
        yield()
        assertEquals(listOf("late-handle"), service.cancelled)
        assertNull(controller.state.value.challenge)
    }
    @Test fun failedVaultWriteNeverMarksConfigurationSaved() = runScenario {
        val service = object : FakeAuth() { override suspend fun configure(id: Int, hash: String) { throw AuthFailure("vault_error") } }
        val controller = AuthController(service, this)
        controller.configure(1, "a".repeat(32))
        assertFalse(controller.state.value.configured)
        assertEquals("vault_error", controller.state.value.errorCode)
    }
    @Test fun failedAccountVerificationDoesNotPublishAnActiveAccount() = runScenario {
        val service = object : FakeAuth() { override suspend fun select(id: String): AuthAccount { throw AuthFailure("not_authorized") } }
        val controller = AuthController(service, this)
        controller.select("tg_1")
        assertTrue(controller.state.value.accounts.isEmpty())
        assertEquals("not_authorized", controller.state.value.errorCode)
    }
    @Test fun floodWaitPreservesRequiredDuration() = runScenario {
        val service = object : FakeAuth() {
            override suspend fun begin(id: String, qr: Boolean): LoginChallenge { throw AuthFailure("flood_wait", 900) }
        }
        val controller = AuthController(service, this, now = { 1000 })
        controller.begin(null)
        assertEquals(901000L, controller.state.value.retryAt)
        assertEquals("flood_wait", controller.state.value.errorCode)
    }
    @Test fun confirmedLoginCanRetrySelectionWithoutAnotherOtpOrPassword() = runScenario {
        var selections = 0
        val service = object : FakeAuth() {
            override suspend fun select(id: String): AuthAccount {
                if (++selections == 1) throw AuthFailure("network_timeout")
                return super.select(id)
            }
        }
        val controller = AuthController(service, this)
        controller.begin("+12345678901")
        controller.submit("12345")
        controller.submit("password")
        assertEquals(LoginPhase.AUTHORIZED, controller.state.value.challenge?.phase)
        assertEquals("network_timeout", controller.state.value.errorCode)
        controller.retryChallenge()
        assertTrue(controller.state.value.accounts.single().active)
        assertNull(controller.state.value.challenge)
        assertEquals(2, selections)
    }
    @Test fun remoteLogoutWithVaultFailureRefreshesInvalidatedAccountFlags() = runScenario {
        val service = object : FakeAuth() {
            override suspend fun logout(id: String) {
                selected = false
                throw AuthFailure("vault_error")
            }
        }
        val controller = AuthController(service, this)
        controller.select("tg_1")
        assertTrue(controller.state.value.accounts.single().active)
        controller.logout("tg_1")
        assertTrue(controller.state.value.accounts.isEmpty())
        assertEquals("vault_error", controller.state.value.errorCode)
    }
    companion object {
        private fun challenge(id: String, phase: LoginPhase) = LoginChallenge(id, phase, null, 0, 0, false, null, null)
    }
}
