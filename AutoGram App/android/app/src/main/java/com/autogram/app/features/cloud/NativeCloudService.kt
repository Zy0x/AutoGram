package com.autogram.app.features.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.autogram_android_bridge.*

class NativeCloudService : CloudService {
    private suspend fun <T> invoke(block: suspend () -> T): T = withContext(Dispatchers.IO) {
        try { block() }
        catch (error: NativeAuthException.RequestFailed) {
            if (error.code == "not_authorized") com.autogram.app.runtime.NativeRuntime.invalidate("authorized_account_changed")
            throw CloudFailure(error.code, error.retryAfterSeconds.toLong())
        }
        catch (_: LinkageError) { throw CloudFailure("native_runtime_unavailable") }
    }
    override suspend fun locations(accountId: String, cursor: String?) = invoke {
        val page = listCloudDialogs(accountId, cursor)
        CloudLocationsPage(page.accountId, page.items.map { CloudLocation(it.id, it.title, it.kind) }, page.nextCursor)
    }
    override suspend fun media(scope: CloudScope, before: Int, query: String) = invoke {
        val page = listCloudMedia(scope.accountId, scope.peerId, before, query)
        CloudMediaPage(page.accountId, page.peerId, page.items.map {
            CloudMedia(it.id, it.name, it.size.coerceAtMost(Long.MAX_VALUE.toULong()).toLong(),
                it.mimeType, it.modifiedMs, it.deliveryKind, it.telegramCategory,
                it.width, it.height, it.durationSeconds, it.thumbnailBytes)
        }, page.nextOffset)
    }
}
