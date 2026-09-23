package com.autogram.app.features.localdownload

enum class LocalDownloadStatus {
    PENDING, RUNNING, WAITING_NETWORK, WAITING_RETRY, WAITING_SYSTEM,
    COMPLETED, FAILED, MISSING, UNSUPPORTED;

    val active: Boolean
        get() = this in setOf(PENDING, RUNNING, WAITING_NETWORK, WAITING_RETRY, WAITING_SYSTEM)
}

enum class LocalDownloadError {
    INVALID_URL, PROBE_FAILED, REDIRECT, CONTENT_TYPE, STORAGE, SERVICE,
    START_FAILED, PERSIST_FAILED, REFRESH_FAILED, CANCEL_FAILED, OPEN_FAILED, LIMIT
}

data class LocalDownloadItem(
    val id: Long,
    val filename: String,
    val status: LocalDownloadStatus,
    val downloaded: Long = 0,
    val total: Long = -1,
    val reason: Int? = null
)

data class LocalDownloadUiState(
    val url: String = "",
    val items: List<LocalDownloadItem> = emptyList(),
    val busy: Boolean = false,
    val refreshing: Boolean = false,
    val error: LocalDownloadError? = null,
    val cancelTarget: LocalDownloadItem? = null
)

internal class LocalDownloadException(val error: LocalDownloadError) : Exception()
