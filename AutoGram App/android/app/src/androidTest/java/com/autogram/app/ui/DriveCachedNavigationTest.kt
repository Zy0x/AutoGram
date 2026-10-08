package com.autogram.app.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelStore
import com.autogram.app.features.cloud.*
import com.autogram.app.features.cloud.avatars.CloudAvatarService
import com.autogram.app.features.cloud.topics.*
import com.autogram.app.viewmodel.DriveThumbnailQuality
import com.autogram.app.viewmodel.DriveViewModel
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/** Real Main dispatcher/store/view-model timing; isolated services never touch credentials or Telegram. */
class DriveCachedNavigationTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Before fun prepare() = keepUnlockedFixtureAwake { compose.activity }
    private class Reads : CloudService, CloudTopicsService, CloudAvatarService {
        var mediaCalls = 0
        var topicCalls = 0
        override suspend fun media(scope: CloudScope, before: Int, query: String): CloudMediaPage {
            mediaCalls++
            return CloudMediaPage(scope.accountId, scope.peerId,
                listOf(CloudMedia(42, "fixture", 20, "image/jpeg", 1, "native", "photo", topicId = scope.topicId)),
                null, scope.topicId)
        }
        override suspend fun locations(accountId: String, cursor: String?) = CloudLocationsPage(accountId,
            listOf(CloudLocation("forum", "Fixture", "forum")), null)
        override suspend fun topics(scope: CloudScope, cursor: TopicCursor?): TopicsPage {
            topicCalls++; return TopicsPage(scope.accountId, scope.peerId, listOf(CloudTopic(7, "Fixture topic")), null)
        }
        override suspend fun thumbnails(scope: CloudScope, messageIds: List<Int>, quality: String) = emptyList<CloudThumbnail>()
        override suspend fun avatar(accountId: String, peerId: String, photoKey: String) = byteArrayOf()
    }
    private fun withModel(test: (DriveViewModel, Reads) -> Unit) {
        val reads = Reads(); val owner = ViewModelStore()
        lateinit var model: DriveViewModel
        compose.runOnIdle {
            model = DriveViewModel(reads, reads, reads); owner.put("fixture", model)
            model.setThumbnailQuality(DriveThumbnailQuality.SAVER)
            model.setScope("fixture", "me", null)
        }
        try { test(model, reads) } finally { compose.runOnIdle { owner.clear() } }
    }
    private fun awaitPeer(model: DriveViewModel, peer: String, topic: Long? = null) {
        compose.waitUntil(5000) {
            val state = model.uiState.value
            state.items.singleOrNull()?.let { it.cloudPeerId == peer && it.topicId == topic } == true && !state.isLoading
        }
    }
    @Test fun returningToCachedDriveCannotLeaveUiEmptyWhenStoreDoesNotEmitAgain() = withModel { model, reads ->
        awaitPeer(model, "me")
        compose.runOnIdle { model.setScope("fixture", "forum", null) }
        awaitPeer(model, "forum")
        compose.runOnIdle { model.setScope("fixture", "me", null) }
        awaitPeer(model, "me")
        compose.runOnIdle {
            assertEquals(2, reads.mediaCalls)
            assertEquals(model.cloudState.value.items.size, model.uiState.value.items.size)
        }
    }
    @Test fun cachedTopicAndForumPickerRestoreTogetherWithoutDuplicateReads() = withModel { model, reads ->
        awaitPeer(model, "me")
        compose.runOnIdle { model.loadLocations() }
        compose.waitUntil(5000) { model.uiState.value.locations.isNotEmpty() }
        compose.runOnIdle { model.chooseLocation(model.uiState.value.locations.single()) }
        awaitPeer(model, "forum")
        compose.waitUntil(5000) { model.uiState.value.topics.size == 1 }
        compose.runOnIdle { model.setTopicFilter(7) }
        awaitPeer(model, "forum", 7)
        compose.runOnIdle { model.setTopicFilter(null) }
        awaitPeer(model, "forum")
        compose.runOnIdle { model.setTopicFilter(7) }
        awaitPeer(model, "forum", 7)
        compose.runOnIdle { model.setScope("fixture", "me", null) }
        awaitPeer(model, "me")
        compose.runOnIdle { model.chooseLocation(model.uiState.value.locations.single()) }
        awaitPeer(model, "forum")
        compose.runOnIdle {
            assertEquals(3, reads.mediaCalls); assertEquals(1, reads.topicCalls)
            assertEquals(7L, model.uiState.value.topics.single().id)
        }
    }
}
