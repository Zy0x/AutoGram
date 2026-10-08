package com.autogram.app.ui

import android.graphics.BitmapFactory
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.features.cloud.*
import com.autogram.app.features.cloud.topics.CloudTopicsStore
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import com.autogram.app.features.cloud.reads.CloudReadCoalescer
import org.junit.Assert.*
import org.junit.Test
import uniffi.autogram_android_bridge.lastSelectedAccount
import uniffi.autogram_android_bridge.selectAuthorizedAccount

/** Opt-in real read-only probe: no OTP, new accounts, logout, uploads, deletion or fixture records. */
class LiveDriveReadOnlyTest {
    @Test fun existingAccountReadsRealAvatarAndTwoTopicPages() = runBlocking {
        check(InstrumentationRegistry.getArguments().getString("autogramReadOnlyLive") == "true") {
            "Real-account inspection requires explicit opt-in on the verified physical phone."
        }
        withTimeout(120_000) {
            // Same cold-start verification as UI. Re-select only the last persisted account.
            val account = lastSelectedAccount() ?: error("No previously selected account")
            val identity = selectAuthorizedAccount(account)
            assertTrue(identity.verified && identity.active)
            assertEquals(account, identity.id)
            val service = NativeCloudService()
            val locations = service.locations(account, null)
            assertEquals(account, locations.accountId)
            val forum = locations.items.firstOrNull { it.kind == "forum" }
                ?: error("No forum in the first real dialog page; further inspection required")
            val photographed = locations.items.firstOrNull { !it.photoKey.isNullOrBlank() }
                ?: error("No server-owned profile photo in the first dialog page")
            val bytes = service.avatar(account, photographed.id, photographed.photoKey!!)
            assertTrue(bytes.isNotEmpty() && bytes.size <= 256 * 1024)
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
                BitmapFactory.Options().apply { inSampleSize = 4 })
            assertNotNull("Actual downloaded profile photo must decode", bitmap)
            val pixels = bitmap!!.width * bitmap.height
            assertTrue(pixels > 0); bitmap.recycle()
            val topics = CloudTopicsStore(service)
            topics.scope(CloudScope(account, forum.id)); topics.load()
            assertNull("Actual forum read failed: ${topics.state.value.error}", topics.state.value.error)
            val chosen = topics.state.value.items.sortedBy { it.id == 1L }.take(2)
            assertEquals("Two real topics required for navigation acceptance", 2, chosen.size)
            var mediaRows = 0
            var nativeMediaReads = 0
            val countingService = object : CloudService {
                override suspend fun locations(accountId: String, cursor: String?) = service.locations(accountId, cursor)
                override suspend fun thumbnails(scope: CloudScope, messageIds: List<Int>, quality: String) = service.thumbnails(scope, messageIds, quality)
                override suspend fun media(scope: CloudScope, before: Int, query: String): CloudMediaPage {
                    nativeMediaReads++
                    return service.media(scope, before, query)
                }
            }
            val media = CloudStore(countingService)
            for (topic in chosen) {
                val scope = CloudScope(account, forum.id, topic.id)
                media.scope(scope); media.media(preferCache = true)
                assertNull("Actual media read failed", media.state.value.error)
                assertEquals(scope, media.state.value.scope)
                mediaRows += media.state.value.items.size
            }
            assertTrue("Selected real topics contained no media; inspect another forum", mediaRows > 0)
            val coalescer = CloudReadCoalescer(this)
            var last: kotlinx.coroutines.Job? = null
            repeat(40) { index ->
                media.scope(CloudScope(account, forum.id, chosen[index % 2].id))
                last = coalescer.submit { media.media(preferCache = true) }
            }
            last!!.join()
            assertEquals("Rapid reopening must reuse real confirmed pages, not issue 40 Telegram reads", 2, nativeMediaReads)
            assertNull(media.state.value.error)
            // Aggregate evidence only; never log account IDs, names, URLs or image bytes.
            Log.i("AutoGramReadOnlyAudit", "photo_bytes=${bytes.size} decoded_pixels=$pixels topics=${chosen.size} media_rows=$mediaRows native_media_reads=$nativeMediaReads")
            assertEquals("Inspection must not select another account", account, lastSelectedAccount())
        }
    }
}
