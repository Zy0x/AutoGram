package com.autogram.app.features.localdownload

import android.content.Context

/** Only numeric DownloadManager IDs and sanitized destination filenames are stored. */
internal class LocalDownloadStore(context: Context) {
    private val preferences = context.getSharedPreferences("local_download_records", Context.MODE_PRIVATE)

    fun records(): Map<Long, String> = preferences.all.entries.mapNotNull { (key, value) ->
        val id = key.toLongOrNull()?.takeIf { it > 0 } ?: return@mapNotNull null
        val name = (value as? String)?.takeIf {
            it.length <= 120 && it.matches(Regex("[a-zA-Z0-9_-]+\\.[a-zA-Z0-9]+"))
        } ?: return@mapNotNull null
        id to name
    }.sortedByDescending { it.first }.take(LocalDownloadPolicy.MAX_TRACKED).toMap()

    fun add(id: Long, filename: String) {
        if (!preferences.edit().putString(id.toString(), filename).commit()) {
            throw LocalDownloadException(LocalDownloadError.PERSIST_FAILED)
        }
    }

    fun forget(id: Long) {
        if (!preferences.edit().remove(id.toString()).commit()) {
            throw LocalDownloadException(LocalDownloadError.PERSIST_FAILED)
        }
    }
}
