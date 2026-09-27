package com.autogram.app.features.auth.storage

import uniffi.autogram_android_bridge.NativeAuthVault
import uniffi.autogram_android_bridge.NativeAuthException

class NativeVaultAdapter(private val vault: AndroidAuthVault) : NativeAuthVault {
    private fun <T> checked(block: () -> T): T = try { block() }
        catch (_: Exception) { throw NativeAuthException.RequestFailed("vault_error", 0u) }
    override fun read(key: String): ByteArray? = checked { vault.read(key) }
    override fun write(key: String, bytes: ByteArray) = checked {
        try { vault.write(key, bytes) } finally { bytes.fill(0) }
    }
    override fun remove(key: String) = checked { vault.remove(key) }
    override fun keys(): List<String> = checked { vault.keys() }
}
