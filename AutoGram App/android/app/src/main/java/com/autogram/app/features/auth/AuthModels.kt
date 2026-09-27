package com.autogram.app.features.auth

data class AuthAccount(val id: String, val displayName: String, val username: String?,
    val verified: Boolean, val active: Boolean)
enum class LoginPhase { CODE, PASSWORD, QR, AUTHORIZED }
// QR tokens and hints are transient only: never SavedStateHandle, logging, or analytics.
data class LoginChallenge(val attemptId: String, val phase: LoginPhase, val qrUrl: String?,
    val expiresAt: Long, val resendAt: Long, val canResend: Boolean,
    val passwordHint: String?, val account: AuthAccount?)
data class AuthUiState(val configured: Boolean = false, val accounts: List<AuthAccount> = emptyList(),
    val busy: Boolean = false, val challenge: LoginChallenge? = null,
    val attemptId: String? = null, val errorCode: String? = null, val retryAt: Long = 0)
class AuthFailure(val code: String, val retrySeconds: Long = 0) : Exception(code)

interface AuthService {
    suspend fun configured(): Boolean
    suspend fun configure(id: Int, hash: String)
    suspend fun accounts(): List<AuthAccount>
    suspend fun create(phone: String?): String
    suspend fun begin(id: String, qr: Boolean): LoginChallenge
    suspend fun code(id: String, code: String): LoginChallenge
    suspend fun password(id: String, password: String): LoginChallenge
    suspend fun resend(id: String): LoginChallenge
    suspend fun poll(id: String): LoginChallenge
    suspend fun select(id: String): AuthAccount
    suspend fun logout(id: String)
    suspend fun lastSelected(): String?
    // Native cancellation is non-blocking and does not need network access.
    fun cancel(id: String)
}
