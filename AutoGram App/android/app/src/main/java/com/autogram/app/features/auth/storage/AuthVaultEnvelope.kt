package com.autogram.app.features.auth.storage

import java.security.GeneralSecurityException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Version 1: AGAV | version byte | 12-byte nonce | ciphertext | 16-byte GCM tag. */
internal object AuthVaultEnvelope {
    const val MAX_PLAINTEXT_BYTES = 2 * 1024 * 1024
    private const val NONCE_BYTES = 12
    private const val TAG_BITS = 128
    private val header = byteArrayOf(0x41, 0x47, 0x41, 0x56, 1)
    private val ciphertextOffset = header.size + NONCE_BYTES
    val maxEncodedBytes = ciphertextOffset + MAX_PLAINTEXT_BYTES + TAG_BITS / 8

    fun encrypt(name: String, bytes: ByteArray, key: SecretKey): ByteArray {
        require(bytes.size <= MAX_PLAINTEXT_BYTES) { "Vault record exceeds size limit" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        // AndroidKeyStore generates the nonce; caller-provided encryption IVs are forbidden.
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val nonce = cipher.iv
        if (nonce.size != NONCE_BYTES) throw GeneralSecurityException("Unsupported vault nonce")
        authenticate(cipher, name)
        return header + nonce + cipher.doFinal(bytes)
    }

    fun decrypt(name: String, envelope: ByteArray, key: SecretKey): ByteArray {
        if (envelope.size !in (ciphertextOffset + TAG_BITS / 8)..maxEncodedBytes ||
            !envelope.copyOfRange(0, header.size).contentEquals(header)
        ) throw AuthVaultCorruptRecordException()

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(TAG_BITS, envelope.copyOfRange(header.size, ciphertextOffset)),
        )
        authenticate(cipher, name)
        // doFinal returns plaintext only after the complete record passes authentication.
        return try {
            cipher.doFinal(envelope, ciphertextOffset, envelope.size - ciphertextOffset)
        } catch (failure: GeneralSecurityException) {
            throw AuthVaultCorruptRecordException(failure)
        }
    }

    private fun authenticate(cipher: Cipher, name: String) {
        cipher.updateAAD(header)
        cipher.updateAAD(name.toByteArray(Charsets.US_ASCII))
    }
}

/** The UI owns localized error presentation; storage never logs keys or record contents. */
class AuthVaultCorruptRecordException(cause: Throwable? = null) :
    GeneralSecurityException("Vault record failed validation", cause)

/** Requires explicit account recovery; callers must not silently reset the vault. */
class AuthVaultKeyUnavailableException(cause: Throwable? = null) :
    GeneralSecurityException("Vault encryption key is unavailable", cause)
