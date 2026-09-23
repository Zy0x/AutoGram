package com.autogram.app.features.localdownload

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class LocalDownloadViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = LocalDownloadRepository(application)
    private val operations = Mutex()
    private val mutableState = MutableStateFlow(LocalDownloadUiState())
    val uiState = mutableState.asStateFlow()
    private var initialUrlAccepted = false

    /** In-memory only. Never put URLs in SavedStateHandle, preferences, or logs. */
    fun acceptInitialUrl(value: String) {
        if (initialUrlAccepted) return
        initialUrlAccepted = true
        updateUrl(value)
    }

    fun updateUrl(value: String) {
        if (!mutableState.value.busy) {
            mutableState.update { it.copy(url = value.take(LocalDownloadPolicy.MAX_URL_LENGTH + 1), error = null) }
        }
    }

    /** Called on entry, foreground return, and periodically only while the screen is active. */
    suspend fun refresh() = operations.withLock {
        mutableState.update { it.copy(refreshing = true) }
        try {
            val items = withContext(Dispatchers.IO) { repository.refresh() }
            mutableState.update {
                it.copy(items = items, error = it.error.takeUnless { error -> error == LocalDownloadError.REFRESH_FAILED })
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            mutableState.update { it.copy(error = LocalDownloadError.REFRESH_FAILED) }
        } finally {
            mutableState.update { it.copy(refreshing = false) }
        }
    }

    fun startDownload() {
        val file = LocalDownloadPolicy.validate(mutableState.value.url)
        if (file == null) {
            mutableState.update { it.copy(error = LocalDownloadError.INVALID_URL) }
            return
        }
        operate(LocalDownloadError.START_FAILED) {
            withContext(Dispatchers.IO) { repository.enqueue(file) }
            mutableState.update { it.copy(url = "") }
        }
    }

    fun requestCancel(item: LocalDownloadItem) {
        if (item.status.active && !mutableState.value.busy) mutableState.update { it.copy(cancelTarget = item) }
    }

    fun dismissCancel() { mutableState.update { it.copy(cancelTarget = null) } }

    fun confirmCancel() {
        val target = mutableState.value.cancelTarget ?: return
        dismissCancel()
        operate(LocalDownloadError.CANCEL_FAILED) { withContext(Dispatchers.IO) { repository.cancel(target.id) } }
    }

    fun forget(id: Long) = operate(LocalDownloadError.PERSIST_FAILED) {
        withContext(Dispatchers.IO) { repository.forget(id) }
    }

    fun open(id: Long) = operate(LocalDownloadError.OPEN_FAILED) {
        val intent = withContext(Dispatchers.IO) { repository.openIntent(id) }
        getApplication<Application>().startActivity(intent)
    }

    private fun operate(fallback: LocalDownloadError, action: suspend () -> Unit) {
        if (mutableState.value.busy) return
        mutableState.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                operations.withLock { action() }
            } catch (error: CancellationException) {
                throw error
            } catch (error: LocalDownloadException) {
                mutableState.update { it.copy(error = error.error) }
            } catch (_: Exception) {
                mutableState.update { it.copy(error = fallback) }
            } finally {
                mutableState.update { it.copy(busy = false) }
            }
            refresh()
        }
    }
}
