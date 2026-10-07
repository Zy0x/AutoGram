package com.autogram.app.features.cloud.topics

import com.autogram.app.features.cloud.CloudFailure
import com.autogram.app.features.cloud.CloudScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class CloudTopic(val id: Long, val title: String, val topMessageId: Long? = null,
    val isClosed: Boolean = false, val colorHex: String? = null, val iconEmoji: String? = null,
    val messageCount: Int? = null)
data class TopicCursor(val date: Int, val messageId: Int, val topicId: Int)
data class TopicsPage(val accountId: String, val peerId: String, val items: List<CloudTopic>, val next: TopicCursor?)
data class TopicsState(val scope: CloudScope = CloudScope(), val items: List<CloudTopic> = emptyList(),
    val next: TopicCursor? = null, val loading: Boolean = false, val error: String? = null, val retryAtMs: Long = 0)
interface CloudTopicsService {
    suspend fun topics(scope: CloudScope, cursor: TopicCursor?): TopicsPage
}

/** No legacy local topic rows: a server identity is required before any topic can be selected. */
class CloudTopicsStore(private val service: CloudTopicsService, private val now: () -> Long = System::currentTimeMillis) {
    private val mutable = MutableStateFlow(TopicsState())
    val state = mutable.asStateFlow()
    private var revision = 0L
    private val visited = mutableSetOf<TopicCursor>()
    fun scope(scope: CloudScope) {
        revision++
        visited.clear()
        val current = mutable.value
        val retryAt = if (scope.accountId == current.scope.accountId) current.retryAtMs else 0
        mutable.value = TopicsState(scope = scope.copy(topicId = null), retryAtMs = retryAt,
            error = if (retryAt > now()) current.error ?: "flood_wait" else null)
    }
    suspend fun load(append: Boolean = false) {
        val request = mutable.value
        if (request.scope.accountId.isBlank() || request.loading || request.retryAtMs > now()) return
        val cursor = if (append) request.next ?: return else null
        if (!append) visited.clear()
        val identity = ++revision
        mutable.update { it.copy(loading = true, error = null) }
        try {
            val page = service.topics(request.scope, cursor)
            if (identity != revision) return
            if (page.accountId != request.scope.accountId || page.peerId != request.scope.peerId)
                throw CloudFailure("account_changed")
            if (page.next != null && (page.next == cursor || page.next in visited ||
                    page.next.topicId <= 0 || page.next.messageId < 0 || page.next.date < 0))
                throw CloudFailure("cloud_cursor_invalid")
            if (cursor != null) visited.add(cursor)
            mutable.update { it.copy(loading = false,
                items = ((if (append) it.items else emptyList()) + page.items).distinctBy { topic -> topic.id },
                next = page.next, error = null) }
        } catch (cancelled: CancellationException) {
            if (identity == revision) mutable.update { it.copy(loading = false) }
            throw cancelled
        } catch (error: Exception) {
            if (identity != revision) return
            val failure = error as? CloudFailure ?: CloudFailure("cloud_request_failed")
            mutable.update { it.copy(loading = false, error = failure.code,
                retryAtMs = now() + failure.retryAfterSeconds.coerceIn(0, 86400 * 30).times(1000)) }
        }
    }
}
