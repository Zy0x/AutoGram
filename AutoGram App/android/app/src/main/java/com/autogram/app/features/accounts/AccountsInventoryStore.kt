package com.autogram.app.features.accounts

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class AccountSessionItem(val name: String, val status: String, val source: String)

data class AccountsUiState(
    val isLoading: Boolean = false,
    val sessions: List<AccountSessionItem> = emptyList(),
    val errorCode: String? = null
)

/** Offline inventory state, independent of Android/JNI so refresh ordering is testable. */
class AccountsInventoryStore(private val load: suspend () -> List<AccountSessionItem>) {
    private val lock = Any()
    private var generation = 0L
    private val mutableState = MutableStateFlow(AccountsUiState())
    val state = mutableState.asStateFlow()

    suspend fun refresh() {
        val request = synchronized(lock) {
            generation += 1
            mutableState.value = mutableState.value.copy(isLoading = true, errorCode = null)
            generation
        }
        try {
            val sessions = load()
            publish(request) { AccountsUiState(sessions = sessions) }
        } catch (cancelled: CancellationException) {
            publish(request) { it.copy(isLoading = false) }
            throw cancelled
        } catch (_: LinkageError) {
            publish(request) { it.copy(isLoading = false, errorCode = "native_runtime_unavailable") }
        } catch (_: Exception) {
            publish(request) { it.copy(isLoading = false, errorCode = "account_inventory_failed") }
        }
    }

    private fun publish(request: Long, update: (AccountsUiState) -> AccountsUiState) {
        synchronized(lock) {
            if (request == generation) mutableState.value = update(mutableState.value)
        }
    }
}
