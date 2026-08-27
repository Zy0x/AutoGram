package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import java.net.URI
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.autogram_android_bridge.BridgeTransferTask
import uniffi.autogram_android_bridge.upsertTransferTask

data class RemoteUrlUiState(
    val url: String = "",
    val host: String? = null,
    val isSubmitting: Boolean = false,
    val result: RemoteQueueResult? = null
)

enum class RemoteQueueResult { INVALID, QUEUED, FAILED }

class RemoteUrlViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(RemoteUrlUiState())
    val uiState: StateFlow<RemoteUrlUiState> = _uiState.asStateFlow()

    fun acceptSharedUrl(url: String) = updateUrl(url)

    fun updateUrl(value: String) {
        val clean = value.trim()
        _uiState.update { it.copy(url = value, host = parseHost(clean), result = null) }
    }

    fun queue() {
        val clean = _uiState.value.url.trim()
        val host = parseHost(clean)
        if (host == null) {
            _uiState.update { it.copy(result = RemoteQueueResult.INVALID) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, result = null) }
            try {
                upsertTransferTask(
                    BridgeTransferTask(
                        id = "",
                        fileName = host,
                        sourceIdentity = clean,
                        destinationIdentity = "remote-link",
                        stage = "resolve",
                        status = "queued",
                        totalBytes = 0uL,
                        processedBytes = 0uL,
                        speedBps = 0uL,
                        etaSeconds = 0uL,
                        attempt = 0u,
                        paused = false,
                        errorCode = null,
                        updatedMs = System.currentTimeMillis()
                    )
                )
                _uiState.update { it.copy(isSubmitting = false, result = RemoteQueueResult.QUEUED) }
            } catch (_: Exception) {
                _uiState.update { it.copy(isSubmitting = false, result = RemoteQueueResult.FAILED) }
            }
        }
    }

    private fun parseHost(value: String): String? = try {
        val uri = URI(value)
        if ((uri.scheme == "http" || uri.scheme == "https") && !uri.host.isNullOrBlank()) uri.host else null
    } catch (_: Exception) {
        null
    }
}
