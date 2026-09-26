package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autogram.app.features.accounts.AccountSessionItem
import com.autogram.app.features.accounts.AccountsInventoryStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.autogram_android_bridge.listSessionSummaries

class AccountsViewModel : ViewModel() {
    private val inventory = AccountsInventoryStore {
        withContext(Dispatchers.IO) {
            listSessionSummaries().map { AccountSessionItem(it.name, it.status, it.source) }
        }
    }
    val uiState = inventory.state

    init { refresh() }

    fun refresh() {
        viewModelScope.launch { inventory.refresh() }
    }
}
