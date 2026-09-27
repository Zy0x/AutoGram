package com.autogram.app.runtime

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.autogram_android_bridge.*
import kotlinx.coroutines.runBlocking

/** Real packaged JNI and callback wiring; no credentials, network login or account writes. */
@RunWith(AndroidJUnit4::class)
class NativeAuthBridgeTest {
    @Test fun invalidCredentialsFailThroughTypedNativeErrorBeforeAnyStorageWrite() {
        val before = listAuthorizedAccounts().map { it.id }
        try {
            configureApi(-1, "")
            fail("invalid credentials must fail")
        } catch (error: NativeAuthException.RequestFailed) {
            assertEquals("invalid_api_credentials", error.code)
            assertEquals(0u, error.retryAfterSeconds)
        }
        assertEquals(before, listAuthorizedAccounts().map { it.id })
    }
    @Test fun encryptedInventoryAndMissingCancellationUseRealCallbacksWithoutFabricatedLogin() {
        // These callbacks must resolve on the installed native library, not a Kotlin fake.
        authConfigured()
        assertFalse(cancelLogin("nonexistent-test-handle"))
        assertTrue(listAuthorizedAccounts().all { !it.active || it.verified })
    }
    @Test fun asynchronousNativeValidationRunsWithoutCreatingANetworkChallenge() = runBlocking {
        val before = listAuthorizedAccounts().map { it.id }
        try {
            createLoginAttempt("invalid-phone")
            fail("invalid phone must fail before transport creation")
        } catch (error: NativeAuthException.RequestFailed) {
            assertEquals("invalid_phone", error.code)
        }
        assertEquals(before, listAuthorizedAccounts().map { it.id })
    }
}
