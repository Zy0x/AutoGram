package com.autogram.app.features.gate

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import com.autogram.app.features.auth.AuthAccount
import com.autogram.app.features.auth.authErrorLabel
import com.autogram.app.features.gate.components.*
import com.autogram.app.features.gate.wizard.*

/**
 * Top-level Gate controller wrapper.
 * Completely encloses the app until an authenticated account is confirmed.
 * Enables FLAG_SECURE dynamically during gate screens.
 */
@Composable
fun GateRoot(
    onAuthenticated: @Composable (AuthAccount) -> Unit,
    viewModel: GateViewModel = viewModel()
) {
    val gateState by viewModel.gateState.collectAsState()
    val authState by viewModel.authState.collectAsState()

    val activity = LocalContext.current.findActivity()
    val isAuthenticated = gateState is GateState.Authenticated

    DisposableEffect(activity, isAuthenticated) {
        val window = activity?.window
        val wasSecure = window?.attributes?.flags?.and(WindowManager.LayoutParams.FLAG_SECURE) != 0
        if (!isAuthenticated) {
            window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        onDispose {
            if (!isAuthenticated && !wasSecure) {
                window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
        }
    }

    AnimatedContent(
        targetState = gateState,
        transitionSpec = {
            fadeIn(animationSpec = tween(300)) togetherWith fadeOut(animationSpec = tween(200))
        },
        label = "gate_screen_transition"
    ) { state ->
        when (state) {
            is GateState.ColdStartVerifying -> {
                SplashScreen(modifier = Modifier.fillMaxSize())
            }
            is GateState.OfflineRetry -> {
                OfflineRetryScreen(
                    onRetry = { viewModel.verifyColdStartSession() },
                    onSwitchAccount = { viewModel.openSavedAccounts() },
                    errorMessage = state.lastError,
                    modifier = Modifier.fillMaxSize()
                )
            }
            is GateState.VaultCorrupted -> {
                VaultRecoveryDialog(
                    onConfirmReset = { viewModel.resetCorruptedVault() },
                    onDismiss = { viewModel.verifyColdStartSession() }
                )
            }
            is GateState.SavedAccounts -> {
                SavedAccountsGate(
                    accounts = state.accounts,
                    onSelectAccount = { viewModel.selectSavedAccount(it) },
                    onAddNewAccount = { viewModel.startWizard() },
                    isBusy = authState.busy,
                    modifier = Modifier.fillMaxSize()
                )
            }
            is GateState.Onboarding -> {
                when (val step = state.step) {
                    is WizardStep.Welcome -> {
                        WelcomeStep(
                            onStart = { viewModel.startWizard() },
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                    is WizardStep.ApiConfig -> {
                        ApiConfigStep(
                            onSaveAndContinue = { id, hash -> viewModel.saveApiCredentials(id, hash) },
                            onBack = { viewModel.cancelAttempt() },
                            isBusy = authState.busy,
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                    is WizardStep.MethodSelect -> {
                        MethodSelectStep(
                            onSelectPhone = { viewModel.selectLoginMethod(false) },
                            onSelectQr = { viewModel.selectLoginMethod(true) },
                            onBack = { viewModel.cancelAttempt() },
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                    is WizardStep.PhoneInput -> {
                        val errorText = authState.errorCode?.let { stringResource(authErrorLabel(it)) }
                        PhoneInputStep(
                            onSubmitPhone = { viewModel.submitPhone(it) },
                            onBack = { viewModel.cancelAttempt() },
                            isBusy = authState.busy,
                            errorMessage = errorText,
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                    is WizardStep.Challenge -> {
                        val challenge = authState.challenge
                        if (challenge != null) {
                            val errorText = authState.errorCode?.let { stringResource(authErrorLabel(it)) }
                            ChallengeStep(
                                challenge = challenge,
                                onSubmit = { viewModel.submitChallenge(it) },
                                onResend = { viewModel.resendOtp() },
                                onRetry = { viewModel.retryChallenge() },
                                onCancel = { viewModel.cancelAttempt() },
                                isBusy = authState.busy,
                                errorMessage = errorText,
                                modifier = Modifier.fillMaxSize()
                            )
                        } else {
                            SplashScreen(modifier = Modifier.fillMaxSize())
                        }
                    }
                    is WizardStep.VerifiedSuccess -> {
                        VerifiedSuccessStep(
                            account = step.account,
                            onEnterApp = { viewModel.enterApp() },
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                }
            }
            is GateState.Authenticated -> {
                onAuthenticated(state.account)
            }
        }
    }
}

private fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> if (baseContext !== this) baseContext.findActivity() else null
    else -> null
}
