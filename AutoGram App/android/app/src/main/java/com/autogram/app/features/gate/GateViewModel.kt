package com.autogram.app.features.gate

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autogram.app.features.auth.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * ViewModel orchestrating the AutoGram Mandatory Login Gate & Onboarding Wizard.
 * Guarantees that the app remains locked until an authenticated, verified session exists.
 */
class GateViewModel(
    private val authService: AuthService = NativeAuthService()
) : ViewModel() {

    private val mutableGateState = MutableStateFlow<GateState>(GateState.ColdStartVerifying)
    val gateState = mutableGateState.asStateFlow()

    val authController = AuthController(authService, viewModelScope)
    val authState = authController.state

    init {
        observeAuthState()
        verifyColdStartSession()
        viewModelScope.launch {
            com.autogram.app.runtime.NativeRuntime.accountRevision.collect { revision ->
                val previous = mutableGateState.value
                if (previous is GateState.Authenticated) {
                    val snapshot = try {
                        withContext(Dispatchers.IO) { verifiedGateSnapshot(authService) }
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (error: AuthFailure) {
                        GateState.OfflineRetry(error.code)
                    } catch (_: Exception) {
                        GateState.OfflineRetry("network_error")
                    }
                    // Ignore a late read after another account action or gate transition.
                    if (revision == com.autogram.app.runtime.NativeRuntime.accountRevision.value &&
                        mutableGateState.value == previous) mutableGateState.value = snapshot
                }
            }
        }
    }

    private fun observeAuthState() {
        viewModelScope.launch {
            authState.collect { state ->
                val current = mutableGateState.value
                val challenge = state.challenge

                if (challenge != null) {
                    mutableGateState.value = GateState.Onboarding(
                        WizardStep.Challenge(isQr = challenge.phase == LoginPhase.QR)
                    )
                } else if (state.accounts.any { it.active && it.verified } && current is GateState.Onboarding) {
                    val activeAcc = state.accounts.first { it.active && it.verified }
                    mutableGateState.value = GateState.Onboarding(
                        WizardStep.VerifiedSuccess(activeAcc)
                    )
                }
            }
        }
    }

    /**
     * Executes cold-start session verification against Telegram servers.
     */
    fun verifyColdStartSession() {
        mutableGateState.value = GateState.ColdStartVerifying
        viewModelScope.launch {
            try {
                val configured = withContext(Dispatchers.IO) { authService.configured() }
                if (!configured) {
                    mutableGateState.value = GateState.Onboarding(WizardStep.Welcome)
                    return@launch
                }

                val accounts = withContext(Dispatchers.IO) { authService.accounts() }
                if (accounts.isEmpty()) {
                    mutableGateState.value = GateState.Onboarding(WizardStep.MethodSelect)
                    return@launch
                }

                // If there's an active verified account, verify it against Telegram
                val activeAccount = accounts.firstOrNull { it.active } ?: accounts.first()
                try {
                    val verified = withContext(Dispatchers.IO) { authService.select(activeAccount.id) }
                    if (verified.verified) {
                        mutableGateState.value = GateState.Authenticated(verified)
                    } else {
                        mutableGateState.value = GateState.SavedAccounts(authService.accounts())
                    }
                } catch (e: AuthFailure) {
                    when (e.code) {
                        "network_error", "network_timeout" -> {
                            mutableGateState.value = GateState.OfflineRetry(e.code)
                        }
                        "vault_error" -> {
                            mutableGateState.value = GateState.VaultCorrupted
                        }
                        else -> {
                            // Session revoked or expired; stay at saved accounts
                            mutableGateState.value = GateState.SavedAccounts(authService.accounts())
                        }
                    }
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                mutableGateState.value = GateState.OfflineRetry("Koneksi gagal")
            }
        }
    }

    fun startWizard() {
        viewModelScope.launch {
            val configured = authService.configured()
            mutableGateState.value = GateState.Onboarding(
                if (configured) WizardStep.MethodSelect else WizardStep.ApiConfig
            )
        }
    }

    fun saveApiCredentials(id: Int, hash: String) {
        authController.configure(id, hash)
        mutableGateState.value = GateState.Onboarding(WizardStep.MethodSelect)
    }

    fun selectLoginMethod(isQr: Boolean) {
        if (isQr) {
            authController.begin(null)
            mutableGateState.value = GateState.Onboarding(WizardStep.Challenge(isQr = true))
        } else {
            mutableGateState.value = GateState.Onboarding(WizardStep.PhoneInput)
        }
    }

    fun submitPhone(phone: String) {
        authController.begin(phone)
        mutableGateState.value = GateState.Onboarding(WizardStep.Challenge(isQr = false))
    }

    fun submitChallenge(input: String) {
        authController.submit(input)
    }

    fun resendOtp() {
        authController.resend()
    }

    fun retryChallenge() {
        authController.retryChallenge()
    }

    fun cancelAttempt() {
        authController.cancel()
        viewModelScope.launch {
            val accounts = authService.accounts()
            if (accounts.isNotEmpty()) {
                mutableGateState.value = GateState.SavedAccounts(accounts)
            } else {
                val configured = authService.configured()
                mutableGateState.value = GateState.Onboarding(
                    if (configured) WizardStep.MethodSelect else WizardStep.Welcome
                )
            }
        }
    }

    fun selectSavedAccount(account: AuthAccount) {
        viewModelScope.launch {
            try {
                val verified = withContext(Dispatchers.IO) { authService.select(account.id) }
                if (verified.verified) {
                    mutableGateState.value = GateState.Authenticated(verified)
                } else {
                    mutableGateState.value = GateState.SavedAccounts(authService.accounts())
                }
            } catch (e: AuthFailure) {
                if (e.code == "network_error" || e.code == "network_timeout") {
                    mutableGateState.value = GateState.OfflineRetry(e.code)
                } else {
                    mutableGateState.value = GateState.SavedAccounts(authService.accounts())
                }
            } catch (_: Exception) {
                mutableGateState.value = GateState.OfflineRetry("Gagal menghubungkan akun")
            }
        }
    }

    fun enterApp() {
        val current = mutableGateState.value
        if (current is GateState.Onboarding && current.step is WizardStep.VerifiedSuccess) {
            mutableGateState.value = GateState.Authenticated(current.step.account)
        }
    }

    fun openSavedAccounts() {
        viewModelScope.launch {
            val accounts = authService.accounts()
            mutableGateState.value = GateState.SavedAccounts(accounts)
        }
    }

    fun resetCorruptedVault() {
        viewModelScope.launch {
            try {
                // Clear all local records
                val accounts = authService.accounts()
                accounts.forEach { authService.logout(it.id) }
            } catch (_: Exception) {}
            mutableGateState.value = GateState.Onboarding(WizardStep.Welcome)
        }
    }

    fun logout() {
        viewModelScope.launch {
            val accounts = authService.accounts()
            val active = accounts.firstOrNull { it.active }
            if (active != null) {
                authService.logout(active.id)
            }
            val remaining = authService.accounts()
            if (remaining.isNotEmpty()) {
                mutableGateState.value = GateState.SavedAccounts(remaining)
            } else {
                mutableGateState.value = GateState.Onboarding(WizardStep.Welcome)
            }
        }
    }

    override fun onCleared() {
        authController.close()
    }
}
