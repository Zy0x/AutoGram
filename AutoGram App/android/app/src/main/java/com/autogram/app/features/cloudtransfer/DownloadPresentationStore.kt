package com.autogram.app.features.cloudtransfer

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest

/** Last Telegram listing metadata, not authorization, transfer identity or completion proof. */
class DownloadPresentationStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("cloud_download_presentation", Context.MODE_PRIVATE)
    private fun key(account: String, operation: String): String = MessageDigest.getInstance("SHA-256")
        .digest("$account:$operation".toByteArray()).joinToString("") { "%02x".format(it) }
    fun put(account: String, operation: String, name: String, mimeType: String) {
        val row = JSONObject().put("name", name.take(1024)).put("mime", mimeType.take(256))
        check(preferences.edit().putString(key(account, operation), row.toString()).commit())
    }
    fun get(account: String, operation: String): DownloadPresentation? = try {
        preferences.getString(key(account, operation), null)?.let {
            val value = JSONObject(it)
            DownloadPresentation(value.getString("name"), value.getString("mime"))
        }
    } catch (_: Exception) { null }
}

data class DownloadPresentation(val telegramName: String, val telegramMime: String) {
    fun outputName(): String = telegramName.replace(Regex("[\\\\/\\p{Cntrl}]"), "_")
        .trim().take(255).takeUnless { it.isBlank() || it == "." || it == ".." } ?: "download.bin"
    fun outputMime(): String = telegramMime.takeIf {
        it.matches(Regex("[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+"))
    } ?: "application/octet-stream"
}
