package com.autogram.app.features.auth

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** All mutations are on the caller's UI scope. Every response is generation-checked. */
class AuthController(private val service: AuthService, private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis) {
    private val mutable = MutableStateFlow(AuthUiState())
    val state = mutable.asStateFlow()
    private var generation = 0L
    private var work: Job? = null
    private var attempt: String? = null

    fun refresh(restore: Boolean = false) = launch {
        val configured = service.configured()
        val accounts = service.accounts()
        publish { it.copy(configured = configured, accounts = accounts) }
        if (restore) service.lastSelected()?.let { id ->
            service.select(id)
            val verified = service.accounts()
            publish { it.copy(accounts = verified) }
        }
    }

    fun configure(id: Int, hash: String) = launch {
        service.configure(id, hash)
        publish { it.copy(configured = true) }
    }

    fun begin(phone: String?) {
        cancel()
        launch {
            // Creation is local and bounded. Obtain its handle even if this UI was cancelled,
            // then cancel that exact handle instead of leaving an orphaned native challenge.
            val id = withContext(NonCancellable) { service.create(phone) }
            if (!current()) { service.cancel(id); return@launch }
            attempt = id
            publish { it.copy(attemptId = id) }
            accept(service.begin(id, phone == null))
        }
    }

    fun submit(input: String) = launch {
        val challenge = state.value.challenge ?: throw AuthFailure("wrong_auth_step")
        val result = when (challenge.phase) {
            LoginPhase.CODE -> service.code(challenge.attemptId, input)
            LoginPhase.PASSWORD -> service.password(challenge.attemptId, input)
            else -> throw AuthFailure("wrong_auth_step")
        }
        accept(result)
    }
    fun resend() = launch {
        val id = attempt ?: throw AuthFailure("login_expired")
        accept(service.resend(id))
    }
    fun retryChallenge() = launch {
        val challenge = state.value.challenge
        val id = attempt ?: throw AuthFailure("login_expired")
        when (challenge?.phase) {
            LoginPhase.QR -> accept(service.poll(id))
            LoginPhase.AUTHORIZED -> accept(challenge)
            else -> throw AuthFailure("login_expired")
        }
    }
    fun select(id: String) = launch {
        service.select(id)
        val accounts = service.accounts()
        publish { it.copy(accounts = accounts) }
    }
    fun logout(id: String) = launch {
        service.logout(id)
        val accounts = service.accounts()
        publish { it.copy(accounts = accounts) }
    }
    fun cancel() {
        generation++
        attempt?.let(service::cancel)
        attempt = null
        work?.cancel()
        mutable.value = state.value.copy(busy = false, challenge = null, attemptId = null, errorCode = null)
    }
    fun close() = cancel()

    private inner class Request(private val token: Long) {
        fun current() = token == generation
        fun publish(change: (AuthUiState) -> AuthUiState) { if (current()) mutable.value = change(state.value) }
        suspend fun accept(initial: LoginChallenge) {
            var challenge = initial
            while (current()) {
                if (challenge.attemptId != attempt) return
                publish { it.copy(challenge = challenge,
                    busy = challenge.phase == LoginPhase.AUTHORIZED, errorCode = null) }
                when (challenge.phase) {
                    LoginPhase.AUTHORIZED -> {
                        val account = challenge.account ?: throw AuthFailure("not_authorized")
                        service.select(account.id)
                        val accounts = service.accounts()
                        if (!current()) return
                        service.cancel(challenge.attemptId)
                        attempt = null
                        publish { it.copy(accounts = accounts, challenge = null, attemptId = null) }
                        return
                    }
                    LoginPhase.QR -> {
                        delay(1500)
                        if (!current()) return
                        challenge = service.poll(challenge.attemptId)
                    }
                    else -> return
                }
            }
        }
    }
    private fun launch(block: suspend Request.() -> Unit) {
        if (state.value.busy) return
        generation++
        work?.cancel()
        val request = Request(generation)
        mutable.value = state.value.copy(busy = true, errorCode = null)
        work = scope.launch {
            try { request.block() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: AuthFailure) {
                request.publish { it.copy(errorCode = error.code,
                    retryAt = if (error.retrySeconds > 0) now() + error.retrySeconds * 1000 else 0) }
                // Refresh verification flags after a revoked/failed account switch.
                try { val accounts = service.accounts(); request.publish { it.copy(accounts = accounts) } }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { /* Preserve last observed records; error remains visible. */ }
            }
            catch (_: Exception) { request.publish { it.copy(errorCode = "auth_operation_failed") } }
            finally { request.publish { it.copy(busy = false) } }
        }
    }
}
