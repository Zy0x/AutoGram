package com.autogram.app.features.gate

import com.autogram.app.features.auth.AuthService

/** Account-change events follow a server-verified selection or revocation.
 * Read that engine state; selecting again would emit another event indefinitely.
 * An offline session file never makes verified/active true in the native inventory.
 */
internal suspend fun verifiedGateSnapshot(service: AuthService): GateState {
    val accounts = service.accounts()
    val active = accounts.firstOrNull { it.active && it.verified }
    return if (active != null) GateState.Authenticated(active) else GateState.SavedAccounts(accounts)
}
