package com.autogram.app.features.gate

import com.autogram.app.features.auth.AuthAccount

/**
 * State machine representation for the AutoGram Mandatory Login Gate.
 * App navigation remains strictly locked until [GateState.Authenticated] is active.
 */
sealed interface GateState {
    /** Cold-start session verification running against Telegram servers. */
    data object ColdStartVerifying : GateState

    /** Telegram connection timed out or network is offline during verification. */
    data class OfflineRetry(val lastError: String? = null) : GateState

    /** Device keystore is unrecoverable; requires explicit typed user confirmation to reset. */
    data object VaultCorrupted : GateState

    /** Multiple or unverified accounts are present in device storage. */
    data class SavedAccounts(val accounts: List<AuthAccount>) : GateState

    /** The 5-step onboarding wizard for unauthenticated or new accounts. */
    data class Onboarding(val step: WizardStep) : GateState

    /** Account is cryptographically verified with Telegram MTProto; workspace is unlocked. */
    data class Authenticated(val account: AuthAccount) : GateState
}

/**
 * 5-Step Onboarding Wizard sequence:
 * 1. Welcome -> 2. ApiConfig -> 3. MethodSelect -> (PhoneInput / Challenge) -> 5. VerifiedSuccess
 */
sealed interface WizardStep {
    data object Welcome : WizardStep
    data object ApiConfig : WizardStep
    data object MethodSelect : WizardStep
    data object PhoneInput : WizardStep
    data class Challenge(val isQr: Boolean) : WizardStep
    data class VerifiedSuccess(val account: AuthAccount) : WizardStep
}

/** Lightweight offline country prefix for phone number entry. */
data class CountryPrefix(
    val code: String,
    val name: String,
    val flag: String
)

val PopularCountryPrefixes = listOf(
    CountryPrefix("+62", "Indonesia", "🇮🇩"),
    CountryPrefix("+1", "United States / Canada", "🇺🇸"),
    CountryPrefix("+44", "United Kingdom", "🇬🇧"),
    CountryPrefix("+65", "Singapore", "🇸🇬"),
    CountryPrefix("+60", "Malaysia", "🇲🇾"),
    CountryPrefix("+81", "Japan", "🇯🇵"),
    CountryPrefix("+82", "South Korea", "🇰🇷"),
    CountryPrefix("+91", "India", "🇮🇳"),
    CountryPrefix("+61", "Australia", "🇦🇺"),
    CountryPrefix("+49", "Germany", "🇩🇪"),
    CountryPrefix("+33", "France", "🇫🇷"),
    CountryPrefix("+7", "Kazakhstan / Russia", "🇰🇿"),
    CountryPrefix("+971", "United Arab Emirates", "🇦🇪"),
    CountryPrefix("+966", "Saudi Arabia", "🇸🇦"),
    CountryPrefix("+90", "Turkey", "🇹🇷"),
    CountryPrefix("+55", "Brazil", "🇧🇷")
)
