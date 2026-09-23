package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class RemoteUrlUiState(val url: String = "", val host: String? = null)

class RemoteUrlViewModel : ViewModel() {
    private val mutableState = MutableStateFlow(RemoteUrlUiState())
    val uiState: StateFlow<RemoteUrlUiState> = mutableState.asStateFlow()

    fun acceptSharedUrl(url: String) = updateUrl(url)

    fun updateUrl(value: String) {
        val bounded = value.take(8193)
        mutableState.update { it.copy(url = bounded, host = RemoteUrlValidator.parseHost(bounded.trim())) }
    }

    // Do not store an unconsumed remote-link task or signed URL in the Telegram queue.
    // Direct downloads are owned exclusively by features/localdownload.
}
