package com.autogram.app.features.cloud.preview

import android.content.Context
import java.security.MessageDigest

data class PlaybackScope(val account: String, val peer: String, val message: Int)
interface PlaybackHistoryStorage {
    fun long(key: String): Long
    fun save(key: String, position: Long, updated: Long)
    fun remove(key: String)
}

/** No URL, credential or file path is retained. Positions are isolated by account and source. */
class PlaybackHistory(private val storage: PlaybackHistoryStorage, private val clock: () -> Long = System::currentTimeMillis) {
    private fun key(scope: PlaybackScope): String {
        val bytes = "${scope.account.length}:${scope.account}${scope.peer.length}:${scope.peer}:${scope.message}".toByteArray()
        return MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
    fun position(scope: PlaybackScope): Long {
        val key = key(scope)
        val updated = storage.long("time_$key")
        if (updated <= 0 || clock() - updated !in 0..EXPIRY_MS) {
            storage.remove(key); return 0
        }
        return storage.long("position_$key").coerceAtLeast(0)
    }
    fun save(scope: PlaybackScope, position: Long) {
        if (position > 0) storage.save(key(scope), position, clock()) else clear(scope)
    }
    fun clear(scope: PlaybackScope) = storage.remove(key(scope))
    companion object { const val EXPIRY_MS = 90L * 24 * 60 * 60 * 1000 }
}

class AndroidPlaybackPreferences(context: Context) : PlaybackHistoryStorage {
    private val preferences = context.applicationContext.getSharedPreferences("cloud_playback", Context.MODE_PRIVATE)
    var rememberPosition: Boolean
        get() = preferences.getBoolean("remember_position", true)
        set(value) { preferences.edit().putBoolean("remember_position", value).apply() }
    override fun long(key: String) = preferences.getLong(key, 0)
    override fun save(key: String, position: Long, updated: Long) {
        preferences.edit().putLong("position_$key", position).putLong("time_$key", updated).apply()
    }
    override fun remove(key: String) {
        preferences.edit().remove("position_$key").remove("time_$key").apply()
    }
    fun clearHistory() {
        val edit = preferences.edit()
        preferences.all.keys.filter { it.startsWith("position_") || it.startsWith("time_") }.forEach(edit::remove)
        edit.apply()
    }
}
