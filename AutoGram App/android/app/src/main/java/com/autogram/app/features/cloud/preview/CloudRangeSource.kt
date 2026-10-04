package com.autogram.app.features.cloud.preview

import com.autogram.app.features.cloud.CloudFailure
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.Closeable
import java.util.concurrent.atomic.AtomicBoolean
import uniffi.autogram_android_bridge.*

/** Capability-scoped reads. No URL, session material or unbounded buffer crosses into UI. */
class CloudRangeSource(
    val size: Long,
    private val fetch: suspend (Long, Int) -> ByteArray,
    private val release: () -> Unit
) : Closeable {
    private val closed = AtomicBoolean(false)
    private val cache = ExactRangeCache()
    private val reader = Mutex()
    private val closeListeners = java.util.Collections.synchronizedList(mutableListOf<() -> Unit>())

    fun onClose(listener: () -> Unit) {
        if (closed.get()) {
            listener()
        } else {
            closeListeners.add(listener)
        }
    }

    suspend fun read(offset: Long, length: Int): ByteArray {
        if (closed.get()) throw CloudFailure("cloud_stream_closed")
        if (offset < 0 || length < 0) throw CloudFailure("invalid_range")
        if (offset >= size || length == 0) return ByteArray(0)
        val bounded = minOf(length.toLong(), MAX_READ.toLong(), size - offset).toInt()
        return reader.withLock {
            if (closed.get()) throw CloudFailure("cloud_stream_closed")
            val bytes = cache.read(offset, bounded) ?: fetch(offset, bounded).also {
                if (closed.get()) throw CloudFailure("cloud_stream_closed")
                if (it.size != bounded) throw CloudFailure("cloud_media_truncated")
                cache.put(offset, it)
            }
            if (closed.get()) { cache.clear(); throw CloudFailure("cloud_stream_closed") }
            bytes
        }
    }
    override fun close() {
        if (closed.compareAndSet(false, true)) {
            cache.clear()
            closeListeners.forEach { runCatching { it() } }
            closeListeners.clear()
            release()
        }
    }
    companion object {
        const val MAX_READ = 256 * 1024
        suspend fun open(account: String, peer: String, message: Int): CloudRangeSource = withContext(Dispatchers.IO) {
            val stream = try { openCloudMediaStream(account, peer, message) }
            catch (error: NativeAuthException.RequestFailed) {
                if (error.code == "not_authorized") com.autogram.app.runtime.NativeRuntime.invalidate("authorized_account_changed")
                throw CloudFailure(error.code, error.retryAfterSeconds.toLong())
            }
            if (stream.accountId != account || stream.peerId != peer || stream.messageId != message || stream.size > Long.MAX_VALUE.toULong()) {
                closeCloudMediaStream(account, stream.id)
                throw CloudFailure("account_changed")
            }
            CloudRangeSource(stream.size.toLong(), { offset, length ->
                try { readCloudMediaRange(account, stream.id, offset.toULong(), length.toUInt()) }
                catch (error: NativeAuthException.RequestFailed) {
                    if (error.code == "not_authorized") com.autogram.app.runtime.NativeRuntime.invalidate("authorized_account_changed")
                    throw CloudFailure(error.code, error.retryAfterSeconds.toLong())
                }
            }, { closeCloudMediaStream(account, stream.id) })
        }
    }
}
