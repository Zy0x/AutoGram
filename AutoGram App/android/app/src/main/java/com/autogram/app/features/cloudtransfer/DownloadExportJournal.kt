package com.autogram.app.features.cloudtransfer

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest

/** Journal is private app storage, never logged/backed up. Interrupted exports are not overwritten. */
class DownloadExportJournal(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("cloud_download_exports", Context.MODE_PRIVATE)
    private fun key(account: String, operation: String): String = MessageDigest.getInstance("SHA-256")
        .digest("$account:$operation".toByteArray()).joinToString("") { "%02x".format(it) }
    @Synchronized fun started(account: String, operation: String, createdUri: String) {
        val row = JSONObject().put("state", "copying").put("uri", createdUri)
        check(preferences.edit().putString(key(account, operation), row.toString()).commit())
    }
    @Synchronized fun finished(account: String, operation: String, verified: Boolean) {
        val id = key(account, operation)
        val row = preferences.getString(id, null)?.let { JSONObject(it) } ?: JSONObject()
        row.put("state", if (verified) "saved" else "interrupted")
        check(preferences.edit().putString(id, row.toString()).commit())
    }
    fun state(account: String, operation: String): String? = try {
        preferences.getString(key(account, operation), null)?.let { JSONObject(it).optString("state") }
    } catch (_: Exception) { "interrupted" }
}
