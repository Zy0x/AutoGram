package com.autogram.app.features.cloud.avatars

import com.autogram.app.features.cloud.CloudFailure
import com.autogram.app.features.cloud.CloudLocation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

fun interface CloudAvatarService {
    suspend fun avatar(accountId: String, peerId: String, photoKey: String): ByteArray
}
data class AvatarKey(val peerId: String, val photoKey: String)
data class CloudAvatarState(val accountId: String = "", val photos: Map<AvatarKey, ByteArray> = emptyMap())

/** Visible-only small photos; one request at a time, at most 8 MiB retained per account. */
class CloudAvatarStore(private val service: CloudAvatarService,
    private val now: () -> Long = System::currentTimeMillis) {
    private val mutable = MutableStateFlow(CloudAvatarState())
    val state = mutable.asStateFlow()
    private val gate = Semaphore(1)
    private val cache = LinkedHashMap<AvatarKey, ByteArray>(32, 0.75f, true)
    private val pending = mutableSetOf<AvatarKey>()
    private val failedUntil = mutableMapOf<AvatarKey, Long>()
    private var retryAt = 0L
    private var generation = 0L

    fun scope(accountId: String) {
        if (accountId == mutable.value.accountId) return
        generation++; cache.clear(); pending.clear(); failedUntil.clear(); retryAt = 0
        mutable.value = CloudAvatarState(accountId)
    }

    suspend fun load(accountId: String, location: CloudLocation) {
        val photo = location.photoKey?.takeIf { it.isNotBlank() } ?: return
        val key = AvatarKey(location.id, photo)
        if (accountId.isBlank() || accountId != mutable.value.accountId || key in cache ||
            key in pending || retryAt > now() || (failedUntil[key] ?: 0) > now()) return
        val identity = generation
        pending.add(key)
        try {
            gate.withPermit {
                if (identity != generation || retryAt > now()) return@withPermit
                val bytes = service.avatar(accountId, key.peerId, key.photoKey)
                if (identity != generation || mutable.value.accountId != accountId) return@withPermit
                if (bytes.isEmpty() || bytes.size > 256 * 1024) throw CloudFailure("cloud_image_too_large")
                cache[key] = bytes
                while (cache.size > 32) cache.remove(cache.keys.first())
                mutable.value = CloudAvatarState(accountId, cache.toMap())
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            if (identity == generation) {
                // Optional photo failure never becomes a topic/media error.
                val failure = error as? CloudFailure
                if (failure?.code == "flood_wait") retryAt = maxOf(retryAt,
                    now() + failure.retryAfterSeconds.coerceIn(0, 86400 * 30).times(1000))
                failedUntil[key] = now() + 30_000
                while (failedUntil.size > 64) failedUntil.remove(failedUntil.keys.first())
            }
        } finally {
            if (identity == generation) pending.remove(key)
        }
    }
}
