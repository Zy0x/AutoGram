package com.autogram.app.features.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.autogram_android_bridge.*

class NativeCloudService : CloudService, com.autogram.app.features.cloud.topics.CloudTopicsService,
    com.autogram.app.features.cloud.avatars.CloudAvatarService {
    private suspend fun <T> invoke(block: suspend () -> T): T = withContext(Dispatchers.IO) {
        try { block() }
        catch (error: NativeAuthException.RequestFailed) {
            if (error.code == "not_authorized") com.autogram.app.runtime.NativeRuntime.invalidate("authorized_account_changed")
            throw CloudFailure(error.code, error.retryAfterSeconds.toLong())
        }
        catch (_: LinkageError) { throw CloudFailure("native_runtime_unavailable") }
    }
    override suspend fun locations(accountId: String, cursor: String?) = invoke {
        com.autogram.app.features.cloud.reads.NativeCloudReadScheduling.metadata.awaitTurn()
        val page = listCloudDialogs(accountId, cursor)
        CloudLocationsPage(page.accountId, page.items.map {
            CloudLocation(it.id, it.title, it.kind, it.photoKey, it.avatarBytes)
        }, page.nextCursor)
    }
    override suspend fun avatar(accountId: String, peerId: String, photoKey: String) = invoke {
        com.autogram.app.features.cloud.reads.NativeCloudReadScheduling.avatars.awaitTurn()
        fetchCloudAvatar(accountId, peerId, photoKey)
    }
    override suspend fun media(scope: CloudScope, before: Int, query: String) = invoke {
        val topic = scope.topicId
        if (topic != null && topic !in 1..Int.MAX_VALUE.toLong()) throw CloudFailure("invalid_cloud_query")
        com.autogram.app.features.cloud.reads.NativeCloudReadScheduling.metadata.awaitTurn()
        val page = if (topic == null) listCloudMedia(scope.accountId, scope.peerId, before, query)
            else listCloudTopicMedia(scope.accountId, scope.peerId, topic.toInt(), before, query)
        CloudMediaPage(page.accountId, page.peerId, page.items.map {
            CloudMedia(it.id, it.name, it.size.coerceAtMost(Long.MAX_VALUE.toULong()).toLong(),
                it.mimeType, it.modifiedMs, it.deliveryKind, it.telegramCategory,
                it.width, it.height, it.durationSeconds, it.thumbnailBytes, topic)
        }, page.nextOffset, topic)
    }
    override suspend fun topics(scope: CloudScope, cursor: com.autogram.app.features.cloud.topics.TopicCursor?) = invoke {
        com.autogram.app.features.cloud.reads.NativeCloudReadScheduling.metadata.awaitTurn()
        val page = listCloudTopics(scope.accountId, scope.peerId, cursor?.let {
            NativeTopicCursor(it.date, it.messageId, it.topicId)
        })
        com.autogram.app.features.cloud.topics.TopicsPage(page.accountId, page.peerId,
            page.topics.map { com.autogram.app.features.cloud.topics.CloudTopic(it.id.toLong(), it.title,
                it.topMessage.toLong().takeIf { id -> id > 0 }, it.closed,
                "#%06X".format(it.iconColor and 0xFFFFFF)) },
            page.next?.let { com.autogram.app.features.cloud.topics.TopicCursor(it.date, it.messageId, it.topicId) })
    }
    override suspend fun thumbnails(scope: CloudScope, messageIds: List<Int>, quality: String): List<CloudThumbnail> = invoke {
        com.autogram.app.features.cloud.reads.NativeCloudReadScheduling.thumbnails.awaitTurn()
        val result = fetchCloudThumbnails(scope.accountId, scope.peerId, messageIds, quality)
        result.map { CloudThumbnail(it.messageId, it.thumbnailBytes) }
    }
}
