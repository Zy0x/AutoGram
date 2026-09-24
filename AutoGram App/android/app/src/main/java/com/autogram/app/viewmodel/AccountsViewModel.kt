package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.autogram_android_bridge.listSessionSummaries

data class AccountSessionItem(
    val name: String,
    val status: String,
    val source: String
)

data class AccountsUiState(
    val isLoading: Boolean = false,
    val sessions: List<AccountSessionItem> = emptyList(),
    val errorCode: String? = null
)

class AccountsViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(AccountsUiState())
    val uiState: StateFlow<AccountsUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        _uiState.value = _uiState.value.copy(isLoading = true, errorCode = null)
        viewModelScope.launch {
            try {
                val sessions = withContext(Dispatchers.IO) {
                    listSessionSummaries().map { AccountSessionItem(it.name, it.status, it.source) }
                }
                _uiState.value = AccountsUiState(sessions = sessions)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: LinkageError) {
                _uiState.value = AccountsUiState(errorCode = "native_runtime_unavailable")
            } catch (_: Exception) {
                _uiState.value = AccountsUiState(errorCode = "account_inventory_failed")
            }
        }
    }
}
