package com.autogram.app.upload

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.core.app.ActivityScenario
import com.autogram.app.MainActivity
import com.autogram.app.features.cloudtransfer.upload.documentSettings
import com.autogram.app.features.cloudtransfer.upload.UploadScheduling
import com.autogram.app.features.cloudtransfer.upload.UploadSpool
import com.autogram.app.features.cloudtransfer.upload.AndroidUploadSpoolPublisher
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.delay
import org.junit.Assert.*
import org.junit.Test
import uniffi.autogram_android_bridge.*
import java.io.File
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.util.UUID

/** One generated file in #Gudang/Tes only. No logout, session reset, broad deletion or other chat writes. */
class NativeDocumentUploadTest {
    private fun fixtureJournal(name: String): File {
        // Instrumentation runs with the target UID. Keep its journal in a
        // dedicated target-owned fixture directory, outside production metadata.
        val directory = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "device-test-fixtures")
        check(directory.mkdirs() || directory.isDirectory)
        return File(directory, name)
    }
    private fun phase(value: String) = InstrumentationRegistry.getInstrumentation().sendStatus(0,
        android.os.Bundle().apply { putString("stream", "document fixture: $value\n") })

    @Test fun actualDocumentReceiptBytesRetryAndStrongDuplicateReuse() = runBlocking {
        withTimeout(180_000) {
            val destination = resolveUploadDestination()
            phase("approved destination verified")
            val operation = "device-fixture-${UUID.randomUUID()}"
            val filename = "autogram-device-fixture-$operation.bin"
            // Just over two 512KiB parts; generated data contains no personal media.
            val bytes = ByteArray(1_048_713) { ((it * 17 + 31) % 251).toByte() }
            operation.toByteArray(Charsets.UTF_8).copyInto(bytes)
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes)
            val root = File(cloudUploadStagingDirectory()).canonicalFile
            val source = UploadSpool(root, { root.usableSpace }, AndroidUploadSpoolPublisher)
                .import(operation, bytes.size.toLong(), { ByteArrayInputStream(bytes) }, {}).path
            val profileId = "device-fixture-${UUID.randomUUID()}"
            val profile = saveTransferProfile(destination.account, profileId, 0, documentSettings("Device fixture"))
            val input = NativeUploadInput(operation, destination.account, destination.peer, destination.topic,
                source.absolutePath, filename, "application/octet-stream", "AutoGram generated Android upload fixture")
            // Preserve exact ownership before enqueue so failed fixture runs remain
            // diagnosable without scanning or clearing unrelated production jobs.
            val pendingJournal = org.json.JSONObject().put("account", destination.account).put("peer", destination.peer)
                .put("topic", destination.topic).put("operation", operation).put("source", source.absolutePath)
                .put("filename", filename).put("profile", profileId).put("profileRevision", profile.revision)
            fixtureJournal("pending-document-fixture.json").writeText(pendingJournal.toString())
            val queued = enqueueProfiledCloudUpload(input, profileId)
            phase("native queue admitted")
            assertEquals("queued", queued.state)
            assertEquals(destination.account, queued.accountId)
            assertEquals(destination.peer, queued.peerId)
            assertEquals(destination.topic, queued.topicId)
            assertEquals(0uL, queued.uploadedBytes)
            val activity = ActivityScenario.launch(MainActivity::class.java)
            val sent = try {
                activity.onActivity { check(UploadScheduling.startFromUi(it)) { "Worker start was deferred" } }
                var actual = getCloudUpload(destination.account, operation)
                var registrations = 0
                while (actual.state in listOf("queued", "running", "committing", "retry_wait")) {
                    if (registrations++ < 3) check(UploadScheduling.schedule(
                        InstrumentationRegistry.getInstrumentation().targetContext))
                    delay(250)
                    actual = getCloudUpload(destination.account, operation)
                }
                actual
            } finally { activity.close() }
            phase("production worker dispatch returned")
            assertEquals("Actual Telegram confirmation required", "completed", sent.state)
            assertEquals(bytes.size.toULong(), sent.uploadedBytes)
            val message = sent.messageId ?: error("Completed upload had no message receipt")
            assertTrue(message > 0)
            phase("Telegram receipt confirmed")
            val stream = openCloudMediaStream(destination.account, destination.peer, message)
            try {
                assertEquals(bytes.size.toULong(), stream.size)
                val returnedHash = MessageDigest.getInstance("SHA-256")
                var offset = 0uL
                while (offset < stream.size) {
                    val count = minOf(65_536uL, stream.size - offset).toUInt()
                    val chunk = readCloudMediaRange(destination.account, stream.id, offset, count)
                    assertEquals(count.toInt(), chunk.size)
                    returnedHash.update(chunk); offset += chunk.size.toULong()
                }
                assertArrayEquals("Cloud file must contain the exact generated source", hash, returnedHash.digest())
            } finally { closeCloudMediaStream(destination.account, stream.id) }
            phase("cloud bytes matched SHA-256")
            val retried = startCloudUpload(destination.account, operation)
            assertEquals("completed", retried.state); assertEquals(message, retried.messageId)
            val inspected = inspectCloudUploadDuplicates(destination.account, destination.peer, destination.topic,
                source.absolutePath, filename, null)
            assertEquals(destination.account, inspected.accountId)
            assertEquals(destination.peer, inspected.peerId)
            assertEquals(destination.topic, inspected.topicId)
            assertTrue(inspected.matches.any { it.messageId == message && it.exactContent })
            val reuseOperation = "device-fixture-${UUID.randomUUID()}"
            val reused = enqueueCloudUploadSkippingIdentical(input.copy(operationId = reuseOperation), profileId, null)
            check(reused is NativeUploadAdmission.Reused) { "Confirmed identical file must not enqueue another send" }
            assertEquals(message, reused.existing.messageId)
            assertEquals(reused.existing, getReusedCloudUpload(destination.account, reuseOperation))
            assertFalse(listCloudUploads(destination.account).any { it.operationId == reuseOperation })
            // Exact filename server query, scoped to the approved topic. No user files are removed.
            val actual = listCloudTopicMedia(destination.account, destination.peer, destination.topic, 0, filename)
            assertEquals(listOf(message), actual.items.filter { it.name == filename }.map { it.id })
            assertEquals(destination.account, lastSelectedAccount())
            val evidence = org.json.JSONObject().put("account", destination.account).put("peer", destination.peer)
                .put("process", android.os.Process.myPid())
                .put("topic", destination.topic).put("operation", operation).put("reuseOperation", reuseOperation)
                .put("message", message).put("bytes", bytes.size).put("sha256", inspected.sourceSha256)
                .put("fixtureName", filename).put("profile", profileId).put("profileRevision", profile.revision)
            // Private fixture journal permits a separate process-restart read;
            // never log account IDs, tokens, credentials, private paths or media.
            fixtureJournal("document-upload-fixture.json").writeText(evidence.toString())
            deleteTransferProfile(destination.account, profileId, profile.revision)
            check(source.canonicalFile.parentFile == root && source.name == "$operation.staged")
            check(source.delete()) // This generated local source only; preserve the cloud fixture and receipts.
            InstrumentationRegistry.getInstrumentation().sendStatus(0, android.os.Bundle().apply {
                putString("stream", "actual document upload verified; bytes=${bytes.size}, retry kept receipt, duplicate reused without send\n")
            })
        }
    }

    @Test fun previousConfirmedFixtureSurvivesNativeProcessRecreation() = runBlocking {
        withTimeout(120_000) {
        check(InstrumentationRegistry.getArguments().getString("autogramUploadFixture") == "GudangTes")
        val file = fixtureJournal("document-upload-fixture.json")
        check(file.isFile) { "Run the actual fixture upload first" }
        val evidence = org.json.JSONObject(file.readText())
        assertNotEquals("Acceptance requires another native process", evidence.getInt("process"), android.os.Process.myPid())
        val account = lastSelectedAccount() ?: error("No selected account")
        assertEquals(evidence.getString("account"), account)
        val identity = selectAuthorizedAccount(account)
        assertTrue(identity.verified && identity.active)
        val operation = evidence.getString("operation")
        assertFalse(listTransferProfiles(account).any { it.profileId == evidence.getString("profile") })
        val saved = getCloudUpload(account, operation)
        assertEquals("completed", saved.state)
        assertEquals(evidence.getInt("message"), saved.messageId)
        val retried = startCloudUpload(account, operation)
        assertEquals(saved.messageId, retried.messageId)
        val reused = getReusedCloudUpload(account, evidence.getString("reuseOperation")) ?: error("Missing reuse receipt")
        assertEquals(saved.messageId, reused.messageId)
        assertFalse(listCloudUploads(account).any { it.operationId == reused.operationId })
        assertEquals(account, lastSelectedAccount())
        }
    }

    @Test fun confirmedFixtureDownloadsToVerifiedOutput() = runBlocking {
        withTimeout(120_000) {
            check(InstrumentationRegistry.getArguments().getString("autogramUploadFixture") == "GudangTes")
            val journal = fixtureJournal("document-upload-fixture.json")
            check(journal.isFile) { "Run the actual fixture upload first" }
            val evidence = org.json.JSONObject(journal.readText())
            val account = lastSelectedAccount() ?: error("No selected account")
            assertEquals(evidence.getString("account"), account)
            val identity = selectAuthorizedAccount(account)
            assertTrue(identity.verified && identity.active)
            val queued = enqueueCloudDownload(account, evidence.getString("peer"), evidence.getInt("topic"), evidence.getInt("message"))
            val downloaded = runCloudDownload(account, queued.operationId)
            assertEquals("completed", downloaded.state)
            val output = File(downloaded.completedFile ?: error("Missing verified output"))
            assertTrue(output.isFile)
            assertEquals(evidence.getLong("bytes"), output.length())
            val hash = MessageDigest.getInstance("SHA-256")
            output.inputStream().use { stream ->
                val buffer = ByteArray(65_536)
                while (true) { val count = stream.read(buffer); if (count < 0) break; hash.update(buffer, 0, count) }
            }
            assertEquals(evidence.getString("sha256"), hash.digest().joinToString("") { "%02x".format(it) })
            assertEquals(evidence.getString("sha256"), downloaded.sha256)
            assertEquals(downloaded.completedFile, runCloudDownload(account, queued.operationId).completedFile)
            assertEquals(account, lastSelectedAccount())
            // Keep the operation-owned verified fixture for persisted provenance.
            phase("native download output and repeated receipt verified")
        }
    }
}
