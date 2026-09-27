package com.autogram.app.features.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.autogram_android_bridge.*

class NativeAuthService : AuthService {
    private suspend fun <T> invoke(block: suspend () -> T): T = withContext(Dispatchers.IO) {
        try { block() }
        catch (error: NativeAuthException.RequestFailed) {
            throw AuthFailure(error.code, error.retryAfterSeconds.toLong())
        }
        catch (_: LinkageError) { throw AuthFailure("auth_not_initialized") }
    }
    override suspend fun configured() = invoke { authConfigured() }
    override suspend fun configure(id: Int, hash: String) = invoke { configureApi(id, hash) }
    override suspend fun accounts() = invoke { listAuthorizedAccounts().map { it.toAccount() } }
    override suspend fun create(phone: String?) = invoke { createLoginAttempt(phone) }
    override suspend fun begin(id: String, qr: Boolean) = invoke {
        (if (qr) beginQrLogin(id) else beginPhoneLogin(id)).toChallenge()
    }
    override suspend fun code(id: String, code: String) = invoke { submitLoginCode(id, code).toChallenge() }
    override suspend fun password(id: String, password: String) = invoke { submitLoginPassword(id, password).toChallenge() }
    override suspend fun resend(id: String) = invoke { resendLoginCode(id).toChallenge() }
    override suspend fun poll(id: String) = invoke { pollQrLogin(id).toChallenge() }
    override suspend fun select(id: String) = invoke { selectAuthorizedAccount(id).toAccount() }
    override suspend fun logout(id: String) = invoke { logoutAccount(id) }
    override suspend fun lastSelected() = invoke { lastSelectedAccount() }
    override fun cancel(id: String) { try { cancelLogin(id) } catch (_: Exception) { /* No local success is inferred. */ } }
}
private fun NativeAccount.toAccount() = AuthAccount(id, displayName, username, verified, active)
private fun NativeAuthStep.toChallenge() = LoginChallenge(attemptId, when (phase) {
    NativeAuthPhase.CODE -> LoginPhase.CODE
    NativeAuthPhase.PASSWORD -> LoginPhase.PASSWORD
    NativeAuthPhase.QR -> LoginPhase.QR
    NativeAuthPhase.AUTHORIZED -> LoginPhase.AUTHORIZED
}, qrUrl, expiresAt, resendAt, canResend, passwordHint, account?.toAccount())
