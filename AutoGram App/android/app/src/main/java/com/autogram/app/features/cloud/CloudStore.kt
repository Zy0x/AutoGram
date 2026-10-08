package com.autogram.app.features.cloud

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import com.autogram.app.features.cloud.reads.ScopedReadCache

/** Request identities protect publication even when a transport ignores coroutine cancellation. */
class CloudStore(private val service: CloudService, private val now: () -> Long = System::currentTimeMillis) {
    private val mutable = MutableStateFlow(CloudState())
    val state = mutable.asStateFlow()
    private var mediaRevision = 0L
    private var locationsRevision = 0L
    private var thumbnailRevision = 0L
    private data class MediaKey(val scope: CloudScope, val query: String)
    private data class MediaSnapshot(val items: List<CloudMedia>, val next: Int?)
    private data class ThumbnailKey(val account: String, val peer: String, val id: Int, val quality: String)
    private val mediaCache = ScopedReadCache<MediaKey, MediaSnapshot>(now, 300_000, 24, 12L * 1024 * 1024) {
        page -> page.items.sumOf { (it.thumbnailBytes?.size ?: 0).toLong() + 512 + it.name.length * 2 }
    }
    private val thumbnailCache = ScopedReadCache<ThumbnailKey, ByteArray>(now, 300_000, 128, 8L * 1024 * 1024) { it.size.toLong() }
    private val mediaCooldowns = mutableMapOf<Pair<String, Boolean>, Long>()
    private fun mediaKey(scope: CloudScope, query: String) = scope.accountId to (scope.topicId != null || query.isNotBlank())
    fun invalidateThumbnails() { thumbnailRevision++ }

    fun scope(scope: CloudScope) {
        invalidateThumbnails()
        mediaRevision++
        val current = mutable.value
        if (scope.accountId != current.scope.accountId) {
            locationsRevision++; mediaCache.clear(); thumbnailCache.clear()
        }
        val deadline = mediaCooldowns[mediaKey(scope, "")] ?: 0
        val cached = mediaCache.get(MediaKey(scope, ""))
        mutable.value = if (scope.accountId == current.scope.accountId) {
            current.copy(scope = scope, query = "", items = cached?.items ?: emptyList(), nextOffset = cached?.next,
                loading = false, error = if (cached == null && deadline > now()) "flood_wait" else null, retryAtMs = deadline)
        } else CloudState(scope = scope, retryAtMs = deadline, error = if (deadline > now()) "flood_wait" else null)
    }
    fun query(query: String) {
        invalidateThumbnails()
        mediaRevision++
        mutable.update {
            val deadline = mediaCooldowns[mediaKey(it.scope, query)] ?: 0
            it.copy(query = query, items = emptyList(), nextOffset = null, loading = false,
                error = if (deadline > now()) "flood_wait" else null, retryAtMs = deadline)
        }
    }
    private fun failed(error: Throwable): CloudFailure = error as? CloudFailure ?: CloudFailure("cloud_request_failed")
    private fun retryAt(error: CloudFailure) = if (error.code == "flood_wait")
        now() + error.retryAfterSeconds.coerceIn(0, 86400 * 30).times(1000) else 0

    suspend fun media(append: Boolean = false, preferCache: Boolean = false) {
        val request = mutable.value
        if (request.scope.accountId.isBlank() || request.loading) return
        if (!append && preferCache) mediaCache.get(MediaKey(request.scope, request.query))?.let {
            mutable.update { current -> current.copy(items = it.items, nextOffset = it.next, error = null) }
            return
        }
        if (request.retryAtMs > now()) {
            mutable.update { it.copy(error = "flood_wait") }; return
        }
        val offset = if (append) request.nextOffset ?: return else 0
        if (!append) invalidateThumbnails()
        val revision = ++mediaRevision
        mutable.update { it.copy(loading = true, error = null) }
        try {
            val page = service.media(request.scope, offset, request.query)
            if (revision != mediaRevision) return
            if (page.accountId != request.scope.accountId || page.peerId != request.scope.peerId || page.topicId != request.scope.topicId) {
                throw CloudFailure("account_changed")
            }
            if (page.nextOffset != null && (page.nextOffset <= 0 || (offset > 0 && page.nextOffset >= offset))) {
                throw CloudFailure("cloud_cursor_invalid")
            }
            mutable.update { it.copy(loading = false,
                items = ((if (append) it.items else emptyList()) + page.items).distinctBy { item -> item.id },
                nextOffset = page.nextOffset, error = null, retryAtMs = 0) }
            mediaCache.put(MediaKey(request.scope, request.query), MediaSnapshot(mutable.value.items, page.nextOffset))
        } catch (error: CancellationException) {
            if (revision == mediaRevision) mutable.update { it.copy(loading = false) }
            throw error
        } catch (error: Exception) {
            if (revision != mediaRevision) return
            val failure = failed(error)
            if (failure.code == "flood_wait") {
                val key = mediaKey(request.scope, request.query)
                mediaCooldowns[key] = maxOf(mediaCooldowns[key] ?: 0, retryAt(failure))
            }
            mutable.update { it.copy(loading = false, error = failure.code, retryAtMs = retryAt(failure)) }
        }
    }

    suspend fun locations(append: Boolean = false) {
        val request = mutable.value
        if (request.scope.accountId.isBlank() || request.locationsRetryAtMs > now() || request.loadingLocations) return
        val cursor = if (append) request.locationsCursor ?: return else null
        val revision = ++locationsRevision
        mutable.update { it.copy(loadingLocations = true, locationsError = null) }
        try {
            val page = service.locations(request.scope.accountId, cursor)
            if (revision != locationsRevision) return
            if (page.accountId != request.scope.accountId) throw CloudFailure("account_changed")
            mutable.update { it.copy(loadingLocations = false,
                locations = ((if (append) it.locations else emptyList()) + page.items).distinctBy { item -> item.id },
                locationsCursor = page.nextCursor, locationsError = null, locationsRetryAtMs = 0) }
        } catch (error: CancellationException) {
            if (revision == locationsRevision) mutable.update { it.copy(loadingLocations = false) }
            throw error
        } catch (error: Exception) {
            if (revision != locationsRevision) return
            val failure = failed(error)
            mutable.update { it.copy(loadingLocations = false, locationsError = failure.code, locationsRetryAtMs = retryAt(failure)) }
        }
    }

    suspend fun upgradeThumbnails(quality: String, messageIds: List<Int>): Boolean {
        val request = mutable.value
        if (request.scope.accountId.isBlank() || messageIds.isEmpty()) return false
        val currentThumbnailRevision = thumbnailRevision
        val keys = messageIds.distinct().filter { id -> request.items.any { it.id == id } }
            .associateWith { ThumbnailKey(request.scope.accountId, request.scope.peerId, it, quality) }
        if (keys.isEmpty()) return true
        val cached = keys.mapNotNull { (id, key) -> thumbnailCache.get(key)?.let { CloudThumbnail(id, it) } }
        val missing = keys.keys - cached.map { it.messageId }.toSet()
        try {
            if (missing.isNotEmpty() && request.thumbnailRetryAtMs > now()) return false
            val fetched = if (missing.isEmpty()) emptyList() else service.thumbnails(request.scope, missing.toList(), quality)
            if (currentThumbnailRevision != thumbnailRevision) return false
            fetched.forEach { thumbnail -> keys[thumbnail.messageId]?.let { key ->
                if (thumbnail.bytes.isNotEmpty()) thumbnailCache.put(key, thumbnail.bytes)
            } }
            val thumbnails = cached + fetched.filter { it.messageId in keys }
            val map = thumbnails.associate { it.messageId to it.bytes }
            mutable.update { state ->
                val updatedItems = state.items.map { item ->
                    val higherRes = map[item.id]
                    if (higherRes != null) item.copy(thumbnailBytes = higherRes) else item
                }
                state.copy(items = updatedItems, thumbnailRetryAtMs = if (missing.isNotEmpty()) 0 else state.thumbnailRetryAtMs)
            }
            mediaCache.replaceIfFresh(MediaKey(request.scope, request.query), MediaSnapshot(mutable.value.items, mutable.value.nextOffset))
            return true
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            if (currentThumbnailRevision != thumbnailRevision) return false
            val failure = failed(error)
            // Keep real cards. Optional file-byte throttling is not a failed topic/search read.
            if (failure.code == "flood_wait")
                mutable.update { it.copy(thumbnailRetryAtMs = retryAt(failure)) }
            else if (failure.code in setOf("not_authorized", "account_changed"))
                mutable.update { it.copy(error = failure.code) }
            return false
        }
    }
}
