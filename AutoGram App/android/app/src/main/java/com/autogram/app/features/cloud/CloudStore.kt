package com.autogram.app.features.cloud

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Request identities protect publication even when a transport ignores coroutine cancellation. */
class CloudStore(private val service: CloudService, private val now: () -> Long = System::currentTimeMillis) {
    private val mutable = MutableStateFlow(CloudState())
    val state = mutable.asStateFlow()
    private var mediaRevision = 0L
    private var locationsRevision = 0L
    private var thumbnailRevision = 0L
    private val mediaCooldowns = mutableMapOf<Pair<String, Boolean>, Long>()
    private fun mediaKey(scope: CloudScope, query: String) = scope.accountId to (scope.topicId != null || query.isNotBlank())
    fun invalidateThumbnails() { thumbnailRevision++ }

    fun scope(scope: CloudScope) {
        invalidateThumbnails()
        mediaRevision++
        val current = mutable.value
        if (scope.accountId != current.scope.accountId) locationsRevision++
        val deadline = mediaCooldowns[mediaKey(scope, "")] ?: 0
        mutable.value = if (scope.accountId == current.scope.accountId) {
            current.copy(scope = scope, query = "", items = emptyList(), nextOffset = null,
                loading = false, error = if (deadline > now()) "flood_wait" else null, retryAtMs = deadline)
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

    suspend fun media(append: Boolean = false) {
        val request = mutable.value
        if (request.scope.accountId.isBlank() || request.retryAtMs > now() || (append && request.loading)) return
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
        if (request.scope.accountId.isBlank() || request.locationsRetryAtMs > now() || (append && request.loadingLocations)) return
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

    suspend fun upgradeThumbnails(quality: String, messageIds: List<Int>) {
        val request = mutable.value
        if (request.scope.accountId.isBlank() || messageIds.isEmpty() || request.thumbnailRetryAtMs > now()) return
        val currentThumbnailRevision = thumbnailRevision
        try {
            val thumbnails = service.thumbnails(request.scope, messageIds, quality)
            if (currentThumbnailRevision != thumbnailRevision || thumbnails.isEmpty()) return
            val map = thumbnails.associate { it.messageId to it.bytes }
            mutable.update { state ->
                val updatedItems = state.items.map { item ->
                    val higherRes = map[item.id]
                    if (higherRes != null) item.copy(thumbnailBytes = higherRes) else item
                }
                state.copy(items = updatedItems)
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            if (currentThumbnailRevision != thumbnailRevision) return
            val failure = failed(error)
            // Keep real cards. Optional file-byte throttling is not a failed topic/search read.
            if (failure.code == "flood_wait")
                mutable.update { it.copy(thumbnailRetryAtMs = retryAt(failure)) }
            else if (failure.code in setOf("not_authorized", "account_changed"))
                mutable.update { it.copy(error = failure.code) }
        }
    }
}
