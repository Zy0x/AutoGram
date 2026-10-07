package com.autogram.app.features.cloud

data class CloudLocation(val id: String, val title: String, val kind: String,
    val photoKey: String? = null, val avatarBytes: ByteArray? = null)
data class CloudMedia(
    val id: Int, val name: String, val size: Long, val mimeType: String,
    val modifiedMs: Long, val deliveryKind: String, val telegramCategory: String,
    val width: Int? = null, val height: Int? = null, val durationSeconds: Double? = null,
    val thumbnailBytes: ByteArray? = null, val topicId: Long? = null
)
data class CloudLocationsPage(val accountId: String, val items: List<CloudLocation>, val nextCursor: String?)
data class CloudMediaPage(val accountId: String, val peerId: String, val items: List<CloudMedia>, val nextOffset: Int?, val topicId: Long? = null)
data class CloudScope(val accountId: String = "", val peerId: String = "me", val topicId: Long? = null)
data class CloudState(
    val scope: CloudScope = CloudScope(), val query: String = "",
    val locations: List<CloudLocation> = emptyList(), val locationsCursor: String? = null,
    val loadingLocations: Boolean = false, val locationsError: String? = null,
    val items: List<CloudMedia> = emptyList(), val nextOffset: Int? = null,
    val loading: Boolean = false, val error: String? = null, val retryAtMs: Long = 0,
    val locationsRetryAtMs: Long = 0, val thumbnailRetryAtMs: Long = 0
)
data class CloudThumbnail(val messageId: Int, val bytes: ByteArray)
class CloudFailure(val code: String, val retryAfterSeconds: Long = 0) : Exception(code)
interface CloudService {
    suspend fun locations(accountId: String, cursor: String?): CloudLocationsPage
    suspend fun media(scope: CloudScope, before: Int, query: String): CloudMediaPage
    suspend fun thumbnails(scope: CloudScope, messageIds: List<Int>, quality: String): List<CloudThumbnail>
}

