package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import uniffi.autogram_android_bridge.*

data class SettingsUiState(
    val accounts: List<AccountScoreResult> = emptyList(),
    val hardwareProfile: HardwareProfileSummary? = null,
    val storageBudget: StorageBudgetResult? = null,
    val isLoading: Boolean = false,
    val errorMessage: String? = null
)

class SettingsViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        loadSettingsFromBridge()
    }

    fun loadSettingsFromBridge() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            try {
                val (accounts, hardware, storage) = withContext(Dispatchers.IO) {
                    Triple(getAccountScores(), getHardwareProfiles(), getStorageBudget())
                }
                _uiState.update {
                    it.copy(
                        accounts = accounts,
                        hardwareProfile = hardware,
                        storageBudget = storage,
                        isLoading = false
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: LinkageError) {
                _uiState.update { it.copy(isLoading = false, errorMessage = "native_runtime_unavailable") }
            } catch (_: Exception) {
                _uiState.update { it.copy(isLoading = false, errorMessage = "settings_load_failed") }
            }
        }
    }
}
