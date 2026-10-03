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

    fun scope(scope: CloudScope) {
        mediaRevision++; locationsRevision++
        val current = mutable.value
        mutable.value = if (scope.accountId == current.scope.accountId) {
            current.copy(scope = scope, query = "", items = emptyList(), nextOffset = null,
                loading = false, error = null, loadingLocations = false)
        } else CloudState(scope = scope)
    }
    fun query(query: String) {
        mediaRevision++
        mutable.update { it.copy(query = query, items = emptyList(), nextOffset = null, loading = false, error = null) }
    }
    private fun failed(error: Throwable): CloudFailure = error as? CloudFailure ?: CloudFailure("cloud_request_failed")
    private fun retryAt(error: CloudFailure) = now() + error.retryAfterSeconds.coerceIn(0, 86400 * 30).times(1000)

    suspend fun media(append: Boolean = false) {
        val request = mutable.value
        if (request.scope.accountId.isBlank() || request.retryAtMs > now() || (append && request.loading)) return
        val offset = if (append) request.nextOffset ?: return else 0
        val revision = ++mediaRevision
        mutable.update { it.copy(loading = true, error = null) }
        try {
            val page = service.media(request.scope, offset, request.query)
            if (revision != mediaRevision) return
            if (page.accountId != request.scope.accountId || page.peerId != request.scope.peerId) {
                throw CloudFailure("account_changed")
            }
            if (page.nextOffset != null && (page.nextOffset <= 0 || (offset > 0 && page.nextOffset >= offset))) {
                throw CloudFailure("cloud_cursor_invalid")
            }
            mutable.update { it.copy(loading = false,
                items = ((if (append) it.items else emptyList()) + page.items).distinctBy { item -> item.id },
                nextOffset = page.nextOffset, error = null) }
        } catch (error: CancellationException) {
            if (revision == mediaRevision) mutable.update { it.copy(loading = false) }
            throw error
        } catch (error: Exception) {
            if (revision != mediaRevision) return
            val failure = failed(error)
            mutable.update { it.copy(loading = false, error = failure.code, retryAtMs = retryAt(failure)) }
        }
    }

    suspend fun locations(append: Boolean = false) {
        val request = mutable.value
        if (request.scope.accountId.isBlank() || request.retryAtMs > now() || (append && request.loadingLocations)) return
        val cursor = if (append) request.locationsCursor ?: return else null
        val revision = ++locationsRevision
        mutable.update { it.copy(loadingLocations = true, locationsError = null) }
        try {
            val page = service.locations(request.scope.accountId, cursor)
            if (revision != locationsRevision) return
            if (page.accountId != request.scope.accountId) throw CloudFailure("account_changed")
            mutable.update { it.copy(loadingLocations = false,
                locations = ((if (append) it.locations else emptyList()) + page.items).distinctBy { item -> item.id },
                locationsCursor = page.nextCursor, locationsError = null) }
        } catch (error: CancellationException) {
            if (revision == locationsRevision) mutable.update { it.copy(loadingLocations = false) }
            throw error
        } catch (error: Exception) {
            if (revision != locationsRevision) return
            val failure = failed(error)
            mutable.update { it.copy(loadingLocations = false, locationsError = failure.code, retryAtMs = retryAt(failure)) }
        }
    }
}
