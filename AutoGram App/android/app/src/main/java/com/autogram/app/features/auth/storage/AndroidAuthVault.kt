package com.autogram.app.features.auth.storage

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.DataInputStream
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * Bounded encrypted sidecar for opaque auth bytes. This class performs blocking I/O;
 * callers should dispatch off the main thread and own/clear returned plaintext arrays.
 * Names must be opaque identifiers, never credentials. Only ciphertext reaches disk.
 *
 * Production location: files/auth-vault. The existing application backup and device
 * transfer exclusions must remain in force. AtomicFile recovery copies are encrypted.
 * A process-wide monitor serializes all instances, including key creation and recovery;
 * this is a single-process store, not a cross-process storage API.
 *
 * read returns null only for an absent record; corrupt records, I/O errors and lost keys
 * throw. keys returns sorted committed/recoverable names, without decrypting their data.
 * The 2 MiB limit applies to plaintext; the version-1 envelope adds 33 bytes.
 */
class AndroidAuthVault internal constructor(
    directory: File,
    private val keyAlias: String,
) {
    // Android may expose /data/user/0 through a system symlink. Resolve that trusted
    // context/injected root once, then reject later redirection of root or record paths.
    private val directory = directory.canonicalFile

    constructor(context: Context) : this(
        File(context.applicationContext.filesDir, "auth-vault"),
        "com.autogram.app.auth.vault.aes.v1",
    )

    init {
        require(keyAlias.isNotBlank()) { "Vault key alias must not be empty" }
    }

    fun read(key: String): ByteArray? = synchronized(lock) {
        validateName(key)
        val entries = entries()
        val secret = loadKey(entries, allowCreation = false)
        val record = recordFile(key)
        if (!record.exists() && !File(record.path + ".bak").exists()) {
            return@synchronized null
        }
        if (secret == null) throw AuthVaultKeyUnavailableException()
        val encoded = AtomicFile(record).openRead().use { stream ->
            val size = stream.channel.size()
            if (size !in 1L..AuthVaultEnvelope.maxEncodedBytes.toLong()) {
                throw AuthVaultCorruptRecordException()
            }
            val bytes = ByteArray(size.toInt())
            try {
                DataInputStream(stream).readFully(bytes)
            } catch (failure: java.io.EOFException) {
                throw AuthVaultCorruptRecordException(failure)
            }
            if (stream.read() != -1) throw AuthVaultCorruptRecordException()
            bytes
        }
        AuthVaultEnvelope.decrypt(key, encoded, secret)
    }

    fun write(key: String, bytes: ByteArray): Unit = synchronized(lock) {
        validateName(key)
        require(bytes.size <= AuthVaultEnvelope.MAX_PLAINTEXT_BYTES) {
            "Vault record exceeds size limit"
        }
        val entries = entries()
        val record = recordFile(key)
        val secret = loadKey(entries, allowCreation = true)
            ?: throw AuthVaultKeyUnavailableException()
        // Complete encryption before opening any output file, including AtomicFile sidecars.
        val encoded = AuthVaultEnvelope.encrypt(key, bytes, secret)
        val atomic = AtomicFile(record)
        val output = atomic.startWrite()
        try {
            output.write(encoded)
            output.fd.sync()
            atomic.finishWrite(output)
        } catch (failure: Throwable) {
            atomic.failWrite(output)
            throw failure
        }
        // AtomicFile reports some commit failures through Android logs rather than throws.
        // Confirm the committed ciphertext so a failed rename cannot look like success.
        atomic.openRead().use { input ->
            if (input.channel.size() != encoded.size.toLong()) {
                throw IOException("Vault write did not commit")
            }
            val committed = ByteArray(encoded.size)
            DataInputStream(input).readFully(committed)
            if (!committed.contentEquals(encoded)) throw IOException("Vault write did not commit")
        }
    }

    fun remove(key: String): Unit = synchronized(lock) {
        validateName(key)
        loadKey(entries(), allowCreation = false)
        val record = recordFile(key)
        AtomicFile(record).delete()
        if (record.exists() || File(record.path + ".bak").exists() ||
            File(record.path + ".new").exists()
        ) throw IOException("Vault record could not be removed")
    }

    fun keys(): List<String> = synchronized(lock) {
        val entries = entries()
        loadKey(entries, allowCreation = false)
        entries.mapNotNull { file ->
            // Legacy AtomicFile .bak files are recoverable committed records. An orphaned
            // .new is uncommitted and deliberately not published, but still prevents rekeying.
            val base = file.name.removeSuffix(".bak")
            if (!base.endsWith(RECORD_SUFFIX)) return@mapNotNull null
            val name = base.removeSuffix(RECORD_SUFFIX)
            if (!validName.matches(name)) throw AuthVaultCorruptRecordException()
            recordFile(name)
            if (!file.isFile) throw AuthVaultCorruptRecordException()
            name
        }.distinct().sorted()
    }

    private fun entries(): List<File> {
        val absolute = directory.absoluteFile
        if (absolute.canonicalFile != absolute) throw IOException("Invalid vault directory")
        if (!absolute.exists()) {
            if (!absolute.mkdirs() && !absolute.isDirectory) {
                throw IOException("Vault directory could not be created")
            }
        }
        if (!absolute.isDirectory) throw IOException("Invalid vault directory")
        return absolute.listFiles()?.toList() ?: throw IOException("Vault directory is unreadable")
    }

    private fun recordFile(name: String): File {
        val base = File(directory.absoluteFile, name + RECORD_SUFFIX)
        for (suffix in listOf("", ".bak", ".new")) {
            val candidate = File(base.path + suffix)
            if (candidate.canonicalFile != candidate.absoluteFile ||
                (candidate.exists() && !candidate.isFile)
            ) throw IOException("Invalid vault record path")
        }
        return base
    }

    private fun loadKey(entries: List<File>, allowCreation: Boolean): SecretKey? {
        try {
            // Never cache key handles: deletion/invalidation must be detected on every call.
            val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
            if (store.containsAlias(keyAlias)) {
                return store.getKey(keyAlias, null) as? SecretKey
                    ?: throw AuthVaultKeyUnavailableException()
            }
            // Include recovery files and unknown entries. Restored or partial vault data
            // must never be overwritten with ciphertext from a silently regenerated key.
            if (entries.isNotEmpty()) throw AuthVaultKeyUnavailableException()
            if (!allowCreation) return null
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
                init(
                    KeyGenParameterSpec.Builder(
                        keyAlias,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                    )
                        .setKeySize(256)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setRandomizedEncryptionRequired(true)
                        .build(),
                )
                generateKey()
            }
        } catch (failure: AuthVaultKeyUnavailableException) {
            throw failure
        } catch (failure: GeneralSecurityException) {
            throw AuthVaultKeyUnavailableException(failure)
        }
    }

    private fun validateName(name: String) {
        require(validName.matches(name)) { "Invalid vault record name" }
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val RECORD_SUFFIX = ".vault"
        val validName = Regex("[a-zA-Z0-9_-]{1,80}")
        val lock = Any()
    }
}
