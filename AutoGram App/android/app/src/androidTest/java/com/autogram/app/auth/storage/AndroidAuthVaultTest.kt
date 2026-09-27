package com.autogram.app.auth.storage

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.features.auth.storage.AndroidAuthVault
import com.autogram.app.features.auth.storage.AuthVaultCorruptRecordException
import com.autogram.app.features.auth.storage.AuthVaultKeyUnavailableException
import java.io.File
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Real AndroidKeyStore tests; every fixture is synthetic bytes in an isolated namespace. */
@RunWith(AndroidJUnit4::class)
class AndroidAuthVaultTest {
    private lateinit var context: Context
    private lateinit var directory: File
    private lateinit var alias: String
    private lateinit var vault: AndroidAuthVault

    @Before fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        val id = UUID.randomUUID().toString()
        directory = File(context.noBackupFilesDir, "auth-vault-test-$id")
        alias = "com.autogram.app.test.auth.vault.$id"
        vault = AndroidAuthVault(directory, alias)
    }

    @After fun tearDown() {
        try {
            keyStore().deleteEntry(alias)
        } finally {
            // Only this test's UUID-scoped directory is eligible for cleanup.
            check(directory.canonicalFile.parentFile == context.noBackupFilesDir.canonicalFile)
            check(directory.name.startsWith("auth-vault-test-"))
            check(!directory.exists() || directory.deleteRecursively())
        }
    }

    @Test fun realKeystoreRoundTripAcrossInstancesAndRemoval() {
        val payload = fixture(4096)
        vault.write("account_1", payload)
        val reopened = AndroidAuthVault(directory, alias)
        assertArrayEquals(payload, reopened.read("account_1"))
        assertEquals(listOf("account_1"), reopened.keys())
        val key = keyStore().getKey(alias, null)
        assertEquals("AES", key.algorithm)
        assertNull("Keystore key must not be exportable", key.encoded)
        assertFalse(record("account_1").readBytes().contentEquals(payload))
        reopened.remove("account_1")
        assertNull(vault.read("account_1"))
        assertTrue(vault.keys().isEmpty())
        reopened.remove("account_1")
    }

    @Test fun emptyVaultReadsDoNotGenerateAKey() {
        assertNull(vault.read("absent"))
        assertTrue(vault.keys().isEmpty())
        vault.remove("absent")
        assertFalse(keyStore().containsAlias(alias))
    }

    @Test fun identicalWritesHaveFreshNoncesAndCiphertext() {
        val payload = fixture(1024)
        vault.write("record", payload)
        val first = record("record").readBytes()
        vault.write("record", payload)
        val second = record("record").readBytes()
        assertFalse(first.contentEquals(second))
        assertFalse(first.copyOfRange(5, 17).contentEquals(second.copyOfRange(5, 17)))
        assertFalse(first.copyOfRange(17, first.size).contentEquals(second.copyOfRange(17, second.size)))
        assertArrayEquals(payload, vault.read("record"))
        assertEquals(listOf("record.vault"), directory.list()!!.sorted())
    }

    @Test fun tamperedHeaderVersionNonceCiphertextAndTagAreRejected() {
        vault.write("record", fixture(512))
        val original = record("record").readBytes()
        for (offset in listOf(0, 4, 5, 17, original.lastIndex)) {
            val modified = original.copyOf()
            modified[offset] = (modified[offset].toInt() xor 1).toByte()
            record("record").writeBytes(modified)
            assertThrows(AuthVaultCorruptRecordException::class.java) { vault.read("record") }
        }
        record("record").writeBytes(original)
        assertArrayEquals(fixture(512), vault.read("record"))
    }

    @Test fun truncatedAndAppendedEnvelopesAreRejected() {
        vault.write("record", fixture(64))
        val original = record("record").readBytes()
        for (size in listOf(0, 1, 4, 5, 16, 17, 32, original.size - 1)) {
            record("record").writeBytes(original.copyOf(size))
            assertThrows(AuthVaultCorruptRecordException::class.java) { vault.read("record") }
        }
        record("record").writeBytes(original + byteArrayOf(0))
        assertThrows(AuthVaultCorruptRecordException::class.java) { vault.read("record") }
    }

    @Test fun ciphertextCannotBeSubstitutedUnderAnotherRecordName() {
        vault.write("source", fixture(100))
        vault.write("destination", fixture(200))
        record("destination").writeBytes(record("source").readBytes())
        assertThrows(AuthVaultCorruptRecordException::class.java) { vault.read("destination") }
        assertArrayEquals(fixture(100), vault.read("source"))
    }

    @Test fun invalidNamesAreRejectedBeforeCreatingFilesOrKeys() {
        val invalid = listOf("", ".", "..", "../outside", "a/b", "a\\b", "/absolute",
            "a.b", "a b", "a\n", "a\u0000", "é", "Ａ", "a".repeat(81))
        for (name in invalid) {
            assertThrows(IllegalArgumentException::class.java) { vault.read(name) }
            assertThrows(IllegalArgumentException::class.java) { vault.write(name, fixture(1)) }
            assertThrows(IllegalArgumentException::class.java) { vault.remove(name) }
        }
        assertFalse(directory.exists())
        assertFalse(keyStore().containsAlias(alias))
    }

    @Test fun validBoundaryNamesAndEmptyPayloadAreSupported() {
        for (name in listOf("A", "a".repeat(80), "AZaz09_-")) vault.write(name, byteArrayOf())
        assertEquals(listOf("A", "AZaz09_-", "a".repeat(80)), vault.keys())
        for (name in vault.keys()) assertArrayEquals(byteArrayOf(), vault.read(name))
    }

    @Test fun maximumPayloadRoundTripsAndOversizeWritePreservesRecord() {
        val limit = 2 * 1024 * 1024
        val payload = fixture(limit)
        vault.write("record", payload)
        assertEquals((limit + 33).toLong(), record("record").length())
        assertArrayEquals(payload, vault.read("record"))
        val original = record("record").readBytes()
        assertThrows(IllegalArgumentException::class.java) {
            vault.write("record", ByteArray(limit + 1))
        }
        assertArrayEquals(original, record("record").readBytes())
        record("record").appendBytes(byteArrayOf(0))
        assertThrows(AuthVaultCorruptRecordException::class.java) { vault.read("record") }
    }

    @Test fun lostKeyFailsClosedAcrossEveryOperationAndNewInstances() {
        vault.write("record", fixture(100))
        val original = record("record").readBytes()
        keyStore().deleteEntry(alias)
        for (instance in listOf(vault, AndroidAuthVault(directory, alias))) {
            assertThrows(AuthVaultKeyUnavailableException::class.java) { instance.read("record") }
            assertThrows(AuthVaultKeyUnavailableException::class.java) { instance.read("absent") }
            assertThrows(AuthVaultKeyUnavailableException::class.java) { instance.write("record", fixture(50)) }
            assertThrows(AuthVaultKeyUnavailableException::class.java) { instance.write("new", fixture(50)) }
            assertThrows(AuthVaultKeyUnavailableException::class.java) { instance.keys() }
            assertThrows(AuthVaultKeyUnavailableException::class.java) { instance.remove("record") }
        }
        assertFalse(keyStore().containsAlias(alias))
        assertArrayEquals(original, record("record").readBytes())
        assertEquals(listOf("record.vault"), directory.list()!!.sorted())
    }

    @Test fun recoveryAndUncommittedFilesPreventSilentKeyRegeneration() {
        vault.write("record", fixture(100))
        val original = record("record").readBytes()
        keyStore().deleteEntry(alias)
        check(record("record").delete())
        for (suffix in listOf(".bak", ".new")) {
            val recovery = File(record("record").path + suffix)
            recovery.writeBytes(original)
            assertThrows(AuthVaultKeyUnavailableException::class.java) { vault.write("new", fixture(1)) }
            assertFalse(keyStore().containsAlias(alias))
            assertArrayEquals(original, recovery.readBytes())
            check(recovery.delete())
        }
    }

    @Test fun atomicBackupRecoversLastCommittedEncryptedRecord() {
        val payload = fixture(256)
        vault.write("record", payload)
        val backup = File(record("record").path + ".bak")
        check(record("record").renameTo(backup))
        record("record").writeBytes(byteArrayOf(0))
        assertEquals(listOf("record"), vault.keys())
        assertArrayEquals(payload, vault.read("record"))
        assertFalse(backup.exists())
    }

    @Test fun concurrentInstancesSerializeReadsWritesListsAndRemovals() {
        val executor = Executors.newFixedThreadPool(4)
        try {
            val futures = executor.invokeAll((0 until 4).map { worker ->
                Callable {
                    val instance = AndroidAuthVault(directory, alias)
                    repeat(8) { iteration ->
                        val payload = ByteArray(512) { worker.toByte() }
                        instance.write("shared", payload)
                        val observed = requireNotNull(instance.read("shared"))
                        assertEquals(512, observed.size)
                        assertTrue(observed.all { it == observed[0] })
                        val name = "worker_${worker}_$iteration"
                        instance.write(name, payload)
                        assertTrue(instance.keys().contains(name))
                        assertArrayEquals(payload, instance.read(name))
                        instance.remove(name)
                        assertNull(instance.read(name))
                    }
                }
            }, 60, TimeUnit.SECONDS)
            futures.forEach { it.get() }
            assertEquals(listOf("shared"), vault.keys())
        } finally {
            executor.shutdownNow()
        }
    }

    private fun record(name: String) = File(directory, "$name.vault")

    private fun fixture(size: Int) = ByteArray(size) { ((it * 31 + 7) % 256).toByte() }

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
}
