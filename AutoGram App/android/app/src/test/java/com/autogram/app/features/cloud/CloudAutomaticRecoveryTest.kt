package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.reads.CloudAutomaticRetryBudget
import com.autogram.app.features.cloud.reads.PacedCloudReads
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class CloudAutomaticRecoveryTest {
    @Test fun repeatedWaitNotificationsAllowOnlyOneRecoveryUntilExplicitIntent() {
        val budget = CloudAutomaticRetryBudget()
        assertTrue(budget.take())
        repeat(100) { assertFalse(budget.take()) }
        budget.reset()
        assertTrue(budget.take()); assertFalse(budget.take())
    }

    @Test fun mediaAndOptionalThumbnailRecoveryHaveIndependentBudgets() {
        val media = CloudAutomaticRetryBudget()
        val thumbnail = CloudAutomaticRetryBudget()
        assertTrue(thumbnail.take()); assertFalse(thumbnail.take())
        assertTrue(media.take())
        thumbnail.reset()
        assertFalse(media.take()); assertTrue(thumbnail.take())
    }

    @Test fun repeatedRealServerWaitCannotCreateUnboundedAutomaticRequests() = runBlocking {
        var time = 1000L
        var calls = 0
        val scope = CloudScope("test", "forum", 7)
        val service = object : CloudService {
            override suspend fun media(scope: CloudScope, before: Int, query: String): CloudMediaPage {
                calls++; throw CloudFailure("flood_wait", 1)
            }
            override suspend fun locations(accountId: String, cursor: String?) = CloudLocationsPage(accountId, emptyList(), null)
            override suspend fun thumbnails(scope: CloudScope, messageIds: List<Int>, quality: String) = emptyList<CloudThumbnail>()
        }
        val store = CloudStore(service, { time })
        val budget = CloudAutomaticRetryBudget()
        store.scope(scope); store.media()
        time = 2000
        repeat(100) {
            if (budget.take()) store.media(preferCache = true)
            time += 1000
        }
        assertEquals(2, calls)
        assertEquals("flood_wait", store.state.value.error)
        budget.reset(); if (budget.take()) store.media()
        assertEquals(3, calls)
    }

    @Test fun optionalBatchesHaveConservativeAdmissionWithoutBlockingMetadataLane() = runBlocking {
        var time = 1000L
        val optional = PacedCloudReads(2000, { time }, { time += it })
        val metadata = PacedCloudReads(450, { time }, { time += it })
        optional.awaitTurn()
        metadata.awaitTurn(); assertEquals(1000L, time)
        optional.awaitTurn(); assertEquals(3000L, time)
        metadata.awaitTurn(); assertEquals(3000L, time)
        optional.awaitTurn(); assertEquals(5000L, time)
    }
}
