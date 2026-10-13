package com.autogram.app.upload

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import uniffi.autogram_android_bridge.*
import com.autogram.app.features.cloudtransfer.upload.AndroidUploadSpoolPublisher
import com.autogram.app.features.cloudtransfer.upload.UploadSpool
import com.autogram.app.features.cloudtransfer.upload.documentSettings
import java.io.ByteArrayInputStream
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/** Sends only two generated JPEGs to the server-verified #Gudang/Tes fixture topic. */
class NativePhotoAlbumUploadTest {
    private fun phase(value: String) = InstrumentationRegistry.getInstrumentation().sendStatus(
        0, android.os.Bundle().apply { putString("stream", "photo album fixture: $value\n") })

    private fun fixtureJournal(name: String): File {
        val directory = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "device-test-fixtures")
        check(directory.mkdirs() || directory.isDirectory)
        return File(directory, name)
    }

    private fun generatedJpeg(seed: Int): ByteArray {
        // The tiny 96x72 fixture may be represented by Telegram as inline thumbnail
        // bytes only. Use a real photo rendition so getFile exercises a server range.
        val bitmap = Bitmap.createBitmap(1024, 768, Bitmap.Config.ARGB_8888)
        try {
            var noise = seed
            for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
                noise = noise * 1_664_525 + 1_013_904_223
                val base = when {
                    x < bitmap.width / 2 && y < bitmap.height / 2 -> 0xFFE53935.toInt()
                    x >= bitmap.width / 2 && y < bitmap.height / 2 -> 0xFF43A047.toInt()
                    x < bitmap.width / 2 -> 0xFF1E88E5.toInt()
                    else -> 0xFFFDD835.toInt()
                }
                val variation = ((noise ushr 24) and 0x7F) - 63
                val red = (((base shr 16) and 0xFF) + variation).coerceIn(0, 255)
                val green = (((base shr 8) and 0xFF) - variation).coerceIn(0, 255)
                val blue = ((base and 0xFF) + variation / 2).coerceIn(0, 255)
                bitmap.setPixel(x, y, android.graphics.Color.rgb(red, green, blue))
            }
            val output = java.io.ByteArrayOutputStream()
            check(bitmap.compress(Bitmap.CompressFormat.JPEG, 95, output))
            return output.toByteArray()
        } finally { bitmap.recycle() }
    }

    private fun assertPhotoContent(sourceBytes: ByteArray, returnedBytes: ByteArray, index: Int) {
        val source = BitmapFactory.decodeByteArray(sourceBytes, 0, sourceBytes.size)
            ?: error("Generated source $index is not a readable JPEG")
        val returned = BitmapFactory.decodeByteArray(returnedBytes, 0, returnedBytes.size)
            ?: error("Telegram photo thumbnail $index is not a readable JPEG")
        try {
            assertTrue("Telegram photo thumbnail must have usable dimensions", returned.width > 1 && returned.height > 1)
            val samples = listOf(
                source.width / 4 to source.height / 4,
                source.width * 3 / 4 to source.height / 4,
                source.width / 4 to source.height * 3 / 4,
                source.width * 3 / 4 to source.height * 3 / 4,
            )
            samples.forEach { (x, y) ->
                val expected = source.getPixel(x, y)
                val actual = returned.getPixel(x * returned.width / source.width, y * returned.height / source.height)
                listOf(16, 8, 0).forEach { shift ->
                    val difference = kotlin.math.abs(((expected shr shift) and 0xFF) - ((actual shr shift) and 0xFF))
                    assertTrue("Telegram photo $index content changed beyond JPEG tolerance", difference <= 52)
                }
            }
        } finally {
            source.recycle()
            returned.recycle()
        }
    }

    @Test fun cleanupPreviouslyConfirmedFixtureByExactOperationReceipt() = runBlocking {
        withTimeout(120_000) {
            check(InstrumentationRegistry.getArguments().getString("autogramUploadFixture") == "GudangTes")
            val journal = fixtureJournal("pending-photo-album.json")
            check(journal.isFile) { "No pending generated album fixture is recorded" }
            val evidence = org.json.JSONObject(journal.readText())
            val account = evidence.getString("account")
            val peer = evidence.getString("peer")
            val topic = evidence.getInt("topic")
            val operationIds = evidence.optJSONArray("operations")?.let { operations ->
                (0 until operations.length()).map { operations.getJSONObject(it).getString("operation") }
            } ?: listOf(evidence.getString("operation"))
            check(operationIds.isNotEmpty() && operationIds.all { it.startsWith("device-album-") })
            val destination = resolveUploadDestination()
            assertEquals(account, destination.account)
            assertEquals(peer, destination.peer)
            assertEquals(topic, destination.topic)
            val receipts = operationIds.map { operation -> getCloudAlbum(account, operation).also { receipt ->
                assertEquals("Only the exact fixture's confirmed receipt may be cleaned", "completed", receipt.state)
                assertEquals(account, receipt.accountId)
                assertEquals(peer, receipt.peerId)
                assertEquals(topic, receipt.topicId)
                assertNotNull(receipt.groupedId)
            } }
            val ids = receipts.flatMap { receipt ->
                receipt.messageIds.map { it ?: error("Fixture receipt has an unmapped message") }
            }
            assertEquals(ids.size, ids.toSet().size)
            ids.forEachIndexed { index, id ->
                val page = listCloudTopicMedia(account, peer, topic, id + 1, "")
                val listed = page.items.firstOrNull { it.id == id }
                assertNotNull("Exact receipt photo must be visible in the approved topic", listed)
                assertEquals("photo", listed!!.telegramCategory)
                assertEquals("image/jpeg", listed.mimeType)
            }
            val deletion = deleteCloudMedia(account, peer, topic, ids)
            assertEquals(ids.toSet(), deletion.deletedIds.toSet())
            assertTrue(deletion.failed.isEmpty())
            listTransferProfiles(account).firstOrNull { it.profileId == evidence.getString("profile") }?.let {
                deleteTransferProfile(account, it.profileId, it.revision)
            }
            val root = File(cloudUploadStagingDirectory()).canonicalFile
            val sourcePaths = evidence.getJSONArray("sources")
            for (index in 0 until sourcePaths.length()) {
                val source = File(sourcePaths.getString(index)).canonicalFile
                check(source.parentFile == root && source.name.contains("device-album-"))
                if (source.exists()) check(source.delete())
            }
            fixtureJournal("photo-album-fixture.json").writeText(
                org.json.JSONObject().put("operations", org.json.JSONArray(operationIds))
                    .put("groupedIds", org.json.JSONArray(receipts.mapNotNull { it.groupedId }))
                    .put("messageIds", org.json.JSONArray(ids)).put("deletedIds", org.json.JSONArray(deletion.deletedIds))
                    .put("cleanupOnly", true).toString())
            check(journal.delete())
        }
    }

    @Test fun sendsOneVerifiedTwoPhotoAlbumAndRetryKeepsExactReceipt() = runBlocking {
        withTimeout(240_000) {
            check(InstrumentationRegistry.getArguments().getString("autogramUploadFixture") == "GudangTes")
            val destination = resolveUploadDestination()
            val operation = "device-album-${UUID.randomUUID()}"
            val sourceIds = listOf("$operation-0", "$operation-1")
            val payloads = listOf(generatedJpeg(19), generatedJpeg(73))
            val root = File(cloudUploadStagingDirectory()).canonicalFile
            val sources = payloads.mapIndexed { index, bytes ->
                UploadSpool(root, { root.usableSpace }, AndroidUploadSpoolPublisher).import(
                    sourceIds[index], bytes.size.toLong(), { ByteArrayInputStream(bytes) }, {}).path
            }
            val albumQueue = com.autogram.app.features.cloudtransfer.upload.NativePhotoAlbumQueue()
            val profile = albumQueue.prepareProfile(
                destination.account, "Android photo album fixture", NativeAlbumPacking.MAXIMUM, 10,
            )
            val profileId = profile.profileId
            assertTrue(profile.settings.groupAsAlbum)
            assertEquals(NativePresentationMode.FORCE_NATIVE_MEDIA, profile.settings.presentation)
            val items = sources.mapIndexed { index, source ->
                NativeAlbumItemInput(source.absolutePath, "autogram-$operation-${index + 1}.jpg", "image/jpeg")
            }
            fixtureJournal("pending-photo-album.json").writeText(
                org.json.JSONObject().put("account", destination.account).put("peer", destination.peer)
                    .put("topic", destination.topic).put("operation", operation)
                    .put("sources", org.json.JSONArray(sources.map { it.absolutePath }))
                    .put("profile", profileId).toString())
            val input = NativeAlbumInput(operation, destination.account,
                destination.peer, destination.topic, "Generated AutoGram Android album fixture", items)
            val queued = albumQueue.enqueueBatch(listOf(input), profile).single()
            assertEquals("queued", queued.state)
            assertEquals(2, queued.itemCount.toInt())
            assertEquals(destination.account, queued.accountId)
            assertEquals(destination.peer, queued.peerId)
            assertEquals(destination.topic, queued.topicId)

            var result = startCloudAlbum(destination.account, operation)
            var attempts = 0
            while (result.state in listOf("queued", "preparing", "committing") && attempts++ < 40) {
                delay(500)
                result = getCloudAlbum(destination.account, operation)
            }
            while (result.state == "review_required" && attempts++ < 44) {
                try { result = reconcileCloudAlbum(destination.account, operation) }
                catch (failure: NativeUploadException.RequestFailed) {
                    if (failure.code != "review_required") throw failure
                    delay(750)
                    result = getCloudAlbum(destination.account, operation)
                }
            }
            assertEquals("completed", result.state)
            assertNotNull("Telegram grouped media confirmation is required", result.groupedId)
            val messageIds = result.messageIds.map { it ?: error("Missing exact message mapping") }
            assertEquals(2, messageIds.size)
            assertTrue(messageIds.all { it > 0 })
            assertEquals(2, messageIds.toSet().size)
            phase("confirmed grouped receipt; verifying server media read-back")

            try {
                for (index in messageIds.indices) {
                    phase("reading confirmed Telegram photo thumbnail ${index + 1}/2")
                    val page = listCloudTopicMedia(destination.account, destination.peer, destination.topic,
                        messageIds[index] + 1, "")
                    val listed = page.items.firstOrNull { it.id == messageIds[index] }
                    assertNotNull("Exact receipt photo must be visible in the approved topic", listed)
                    assertEquals("photo", listed!!.telegramCategory)
                    assertEquals("image/jpeg", listed.mimeType)
                    val thumbnail = listed.thumbnailBytes ?: error("Telegram did not return an inline photo thumbnail")
                    phase("checking decoded server thumbnail content")
                    assertPhotoContent(payloads[index], thumbnail, index)
                    val stream = openCloudMediaStream(destination.account, destination.peer, messageIds[index])
                    try {
            assertTrue(
                "Fixture must expose a server photo larger than one range window (actual ${stream.size} bytes)",
                stream.size > 65_536uL,
            )
                        val rangeLength = minOf(65_536uL, stream.size).toUInt()
                        val range = readCloudMediaRange(destination.account, stream.id, 0uL, rangeLength)
                        assertEquals("Telegram photo byte-range length must be exact", rangeLength.toInt(), range.size)
                        assertEquals("Photo range must start with a JPEG header", 0xFF, range[0].toInt() and 0xFF)
                        assertEquals("Photo range must start with a JPEG header", 0xD8, range[1].toInt() and 0xFF)
                        phase("photo ${index + 1}/2 returned an exact ${range.size}-byte server range")
                    } finally { closeCloudMediaStream(destination.account, stream.id) }
                }
                val replay = startCloudAlbum(destination.account, operation)
                assertEquals("completed", replay.state)
                assertEquals(result.messageIds, replay.messageIds)
                assertEquals(result.groupedId, replay.groupedId)
                phase("retry returned the original receipt")
            } finally {
                assertEquals("The selected account changed before fixture cleanup", destination.account, lastSelectedAccount())
                val confirmed = getCloudAlbum(destination.account, operation)
                assertEquals("completed", confirmed.state)
                assertEquals(destination.account, confirmed.accountId)
                assertEquals(destination.peer, confirmed.peerId)
                assertEquals(destination.topic, confirmed.topicId)
                assertEquals(result.groupedId, confirmed.groupedId)
                assertEquals(result.messageIds, confirmed.messageIds)
                messageIds.forEach { id ->
                    val page = listCloudTopicMedia(destination.account, destination.peer, destination.topic, id + 1, "")
                    val listed = page.items.firstOrNull { it.id == id }
                    assertNotNull("Only confirmed photo messages in the approved topic may be cleaned", listed)
                    assertEquals("photo", listed!!.telegramCategory)
                    assertEquals("image/jpeg", listed.mimeType)
                }
                val deletion = deleteCloudMedia(destination.account, destination.peer, destination.topic, messageIds)
                assertEquals(destination.account, deletion.accountId)
                assertEquals(destination.peer, deletion.peerId)
                assertEquals(destination.topic, deletion.topicId)
                assertEquals(messageIds.toSet(), deletion.deletedIds.toSet())
                assertTrue("Only the unique generated album messages may remain for retry cleanup", deletion.failed.isEmpty())
                deleteTransferProfile(destination.account, profileId, profile.revision)
                sources.forEach { source ->
                    check(source.canonicalFile.parentFile == root && source.name.startsWith("$operation-"))
                    check(source.delete())
                }
                fixtureJournal("photo-album-fixture.json").writeText(
                    org.json.JSONObject().put("operation", operation).put("groupedId", result.groupedId)
                        .put("messageIds", org.json.JSONArray(messageIds)).put("deletedIds", org.json.JSONArray(deletion.deletedIds))
                        .put("sha256", org.json.JSONArray(payloads.map { bytes ->
                            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { byte -> "%02x".format(byte) }
                        })).toString())
                check(fixtureJournal("pending-photo-album.json").delete())
                phase("verified fixture cleanup complete")
            }
            Unit
        }
    }

}
